package app.bridgeview.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DirectionsBoat
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SearchOff
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.bridgeview.graph
import app.bridgeview.model.FavouriteShip
import app.bridgeview.model.Favourites
import app.bridgeview.model.ShipSummary
import coil3.compose.AsyncImage
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

/** How long typing has to pause before the search goes to the server (reads are rate-limited) */
private const val SEARCH_DEBOUNCE_MS = 300L
/** How often the favourites are fetched again while they're on screen */
private const val FAVOURITES_REFRESH_MS = 30_000L

/** The favourites, as the server last described them, and whether the last fetch failed */
class FavouriteSummaries(val rows: List<Pair<FavouriteShip, ShipSummary?>>, val error: String?)

/**
 * The stored favourites, fetched again every 30 s while on screen, like the other
 * lists; a failure keeps what's shown, falling back to the names stored with them
 */
@Composable
fun rememberFavouriteSummaries(favourites: List<FavouriteShip>): FavouriteSummaries {
    val graph = LocalContext.current.graph
    var summaries by remember { mutableStateOf<Map<Int, ShipSummary>>(emptyMap()) }
    var error by remember { mutableStateOf<String?>(null) }
    val mmsis = favourites.map { it.mmsi }
    LaunchedEffect(mmsis) {
        while (mmsis.isNotEmpty()) {
            try {
                summaries = graph.api.shipsByMmsi(mmsis).ships.associateBy { it.mmsi }
                error = null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = graph.describe(e)
            }
            delay(FAVOURITES_REFRESH_MS)
        }
    }
    return FavouriteSummaries(Favourites.rows(favourites, summaries), error)
}

/** The "Favourites" section at the top of a list; nothing when there are none */
fun LazyListScope.favouriteItems(
    favourites: FavouriteSummaries,
    starred: Set<Int>,
    toggle: (Int, String) -> Unit,
    onOpenShip: (Int) -> Unit,
) {
    if (favourites.rows.isEmpty()) return
    item(key = "favourites-label") { SectionLabel("Favourites", Modifier.readableWidth().padding(top = 8.dp)) }
    favourites.error?.let { message ->
        item(key = "favourites-error") {
            Text(
                message,
                style = Theme.text(Theme.Style.Footnote),
                color = Theme.colors.secondaryText,
                modifier = Modifier.readableWidth().semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
    }
    // Keyed apart from the list below, which can hold the same ship
    items(favourites.rows, key = { "favourite-${it.first.mmsi}" }) { (favourite, summary) ->
        SummaryRow(
            mmsi = favourite.mmsi,
            name = summary?.name ?: favourite.name,
            summary = summary,
            starred = favourite.mmsi in starred,
            onToggle = toggle,
            onOpen = onOpenShip,
        )
    }
}

@Composable
fun ShipSearchField(query: String, onChange: (String) -> Unit, modifier: Modifier = Modifier) {
    val focus = LocalFocusManager.current
    val colors = Theme.colors
    OutlinedTextField(
        value = query,
        onValueChange = onChange,
        modifier = modifier.fillMaxWidth(),
        placeholder = { Text("Name, MMSI or IMO number") },
        leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
        trailingIcon = if (query.isNotEmpty()) {
            { IconButton(onClick = { onChange("") }) { Icon(Icons.Filled.Close, contentDescription = "Clear search") } }
        } else null,
        singleLine = true,
        shape = RoundedCornerShape(Theme.cornerRadius),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { focus.clearFocus() }),
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = colors.surface,
            unfocusedContainerColor = colors.surface,
            unfocusedBorderColor = colors.hairline,
        ),
    )
}

private sealed interface SearchState {
    data object TooShort : SearchState
    data object Loading : SearchState
    data class Done(val ships: List<ShipSummary>, val more: Boolean) : SearchState
    data class Failed(val message: String) : SearchState
}

@Composable
fun ShipSearchResults(query: String, starred: Set<Int>, toggle: (Int, String) -> Unit, onOpenShip: (Int) -> Unit) {
    val graph = LocalContext.current.graph
    var state by remember { mutableStateOf<SearchState>(SearchState.TooShort) }
    LaunchedEffect(query) {
        if (query.length < 2) {
            state = SearchState.TooShort
            return@LaunchedEffect
        }
        // Results for the last query stay up while typing continues
        delay(SEARCH_DEBOUNCE_MS)
        if (state !is SearchState.Done) state = SearchState.Loading
        state = try {
            graph.api.searchShips(query).let { SearchState.Done(it.ships, it.more) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            SearchState.Failed(graph.describe(e))
        }
    }

    when (val s = state) {
        SearchState.TooShort -> CenteredScroll {
            EmptyState(Icons.Filled.Search, "Keep typing", "Search by a ship's name, or its MMSI or IMO number.")
        }
        SearchState.Loading -> Box(Modifier.fillMaxSize().padding(top = 48.dp), contentAlignment = Alignment.TopCenter) {
            CircularProgressIndicator(Modifier.semantics { contentDescription = "Searching" })
        }
        is SearchState.Failed -> CenteredScroll { EmptyState(Icons.Filled.WifiOff, "Can't search right now", s.message) }
        is SearchState.Done -> if (s.ships.isEmpty()) {
            CenteredScroll {
                EmptyState(
                    Icons.Filled.SearchOff,
                    "No ships match “$query”",
                    "BridgeView knows the ships it has heard near the bridge. Check the spelling, or try the MMSI.",
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
        } else {
            ShipLazyList {
                item(key = "count") {
                    val count = s.ships.size
                    SectionLabel(
                        if (s.more) "Top $count matches" else if (count == 1) "1 ship" else "$count ships",
                        Modifier.readableWidth().padding(top = 8.dp).semantics { liveRegion = LiveRegionMode.Polite },
                    )
                }
                items(s.ships, key = { it.mmsi }) { ship ->
                    SummaryRow(ship.mmsi, ship.name, ship, ship.mmsi in starred, toggle, onOpenShip)
                }
                if (s.more) {
                    item(key = "more") {
                        Text(
                            "More ships match. Type more of the name to narrow it down.",
                            style = Theme.text(Theme.Style.Footnote),
                            color = Theme.colors.secondaryText,
                            modifier = Modifier.readableWidth(),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ShipLazyList(content: LazyListScope.() -> Unit) {
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 72.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        content = content,
    )
}

@Composable
private fun CenteredScroll(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(top = 56.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) { content() }
}

/** One ship in search results or the favourites: photo, name, what it is, what it's doing */
@Composable
private fun SummaryRow(
    mmsi: Int,
    name: String,
    summary: ShipSummary?,
    starred: Boolean,
    onToggle: (Int, String) -> Unit,
    onOpen: (Int) -> Unit,
) {
    val colors = Theme.colors
    val now by rememberNow(30_000)
    val details = summary?.let { s ->
        listOfNotNull(s.summary.ifEmpty { null }, s.destination?.takeIf { it.isNotBlank() }?.let { "To ${Format.place(it)}" })
            .joinToString(" · ")
    }.orEmpty()
    val status = status(summary, now)
    Card(Modifier.readableWidth(), padding = 12.dp, onClick = { onOpen(mmsi) }) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            // Read as one sentence; the star beside it stays its own control
            Row(
                Modifier.weight(1f).clearAndSetSemantics {
                    contentDescription = listOfNotNull(
                        name,
                        summary?.flag?.let { java.util.Locale.Builder().setRegion(it.uppercase()).build().displayCountry.ifEmpty { null } },
                        summary?.let { s -> listOfNotNull(s.shipTypeName, s.length?.let { "$it metres" }).joinToString(", ").ifEmpty { null } },
                        summary?.destination?.takeIf { it.isNotBlank() }?.let { "to ${Format.place(it)}" },
                        status.spoken,
                    ).joinToString(", ")
                },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Thumbnail(summary?.photoUrl)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(name, style = Theme.hull(Theme.Style.Subheadline), maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                        summary?.flagEmoji?.let { Text(it, style = Theme.text(Theme.Style.Subheadline)) }
                    }
                    if (details.isNotEmpty()) {
                        Text(details, style = Theme.text(Theme.Style.Footnote), color = colors.secondaryText, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    Text(status.text, style = Theme.text(Theme.Style.Footnote), color = if (status.live) colors.signal else colors.secondaryText, maxLines = 2)
                }
            }
            // Only on favourites: a ship's added from its page or by pressing and holding
            if (starred) FavouriteToggle(mmsi, name, starred, onToggle)
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = colors.tertiaryText)
        }
    }
}

private data class Status(val text: String, val spoken: String, val live: Boolean)

/** "Upbound · at the bridge in 12 min", "Heard now", "Last under the bridge 2 days ago", … */
private fun status(summary: ShipSummary?, now: Instant): Status {
    val approach = summary?.approach
    val passage = summary?.passage
    return when {
        approach != null -> {
            val eta = Format.minutes(approach.etaMinutes)
            if (eta == "now") Status("${approach.direction.label} · at the bridge now", "${approach.direction.label}, at the bridge now", true)
            else Status(
                "${approach.direction.label} · at the bridge in $eta",
                "${approach.direction.label}, ${Format.spokenArrival(approach.etaMinutes, approach.eta)}",
                true,
            )
        }
        summary?.heard == true -> Status("Heard now", "heard now", true)
        passage != null -> {
            val text = "Last under the bridge ${passage.direction.label.lowercase()} ${Format.relative(passage.time, now)}"
            Status(text, text, false)
        }
        else -> Status("Not heard lately", "not heard lately", false)
    }
}

@Composable
private fun Thumbnail(url: String?) {
    val colors = Theme.colors
    Box(
        Modifier.size(48.dp).clip(RoundedCornerShape(10.dp)).background(colors.hairline),
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Filled.DirectionsBoat, contentDescription = null, tint = colors.tertiaryText, modifier = Modifier.size(22.dp))
        if (url != null) {
            AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize())
        }
    }
}

/** Star that adds the ship to the favourites or takes it off */
@Composable
fun FavouriteToggle(mmsi: Int, name: String, starred: Boolean, onToggle: (Int, String) -> Unit, tint: androidx.compose.ui.graphics.Color? = null) {
    IconButton(
        onClick = { onToggle(mmsi, name) },
        modifier = Modifier.semantics { stateDescription = if (starred) "Favourite" else "Not a favourite" },
    ) {
        Icon(
            if (starred) Icons.Filled.Star else Icons.Filled.StarBorder,
            contentDescription = if (starred) "Remove $name from favourites" else "Add $name to favourites",
            tint = tint ?: if (starred) Theme.colors.signal else Theme.colors.secondaryText,
        )
    }
}

/** The star for a ship's page, following the stored favourites */
@Composable
fun FavouriteToggle(mmsi: Int, name: String) {
    val prefs = LocalContext.current.graph.prefs
    val text by prefs.favourites.flow.collectAsState()
    val starred = remember(text, mmsi) { Favourites.decode(text).any { it.mmsi == mmsi } }
    FavouriteToggle(mmsi, name, starred, onToggle = { m, n -> prefs.toggleFavourite(m, n) })
}
