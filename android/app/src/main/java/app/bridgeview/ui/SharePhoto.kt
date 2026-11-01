package app.bridgeview.ui

import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import app.bridgeview.AppConfig
import app.bridgeview.graph
import app.bridgeview.photo.SharedPhoto
import coil3.compose.AsyncImage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Take or choose a photo of a ship and send it to BridgeView, where it waits for
 * approval before it's shown. The sharer keeps their copyright and licenses it to
 * BridgeView (terms.html); it's credited to the name they give, or to no one.
 */
@Composable
fun SharePhotoScreen(mmsi: Int, shipName: String, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val graph = context.graph
    val scope = rememberCoroutineScope()
    val savedCredit by graph.prefs.photoCredit.flow.collectAsState()
    var image by rememberSaveable { mutableStateOf<Uri?>(null) }
    var note by rememberSaveable { mutableStateOf("") }
    var agreed by rememberSaveable { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sent by remember { mutableStateOf(false) }
    var cameraFile by rememberSaveable { mutableStateOf<Uri?>(null) }
    val hasCamera = remember { context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            image = uri
            error = null
        }
    }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { taken ->
        if (taken) {
            image = cameraFile
            error = null
        }
    }
    fun takePhoto() {
        val dir = File(context.cacheDir, "photos").apply { mkdirs() }
        val file = File(dir, "share-${System.currentTimeMillis()}.jpg")
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.photos", file)
        cameraFile = uri
        camera.launch(uri)
    }

    fun send() {
        val uri = image ?: return
        scope.launch {
            sending = true
            try {
                val prepared = withContext(Dispatchers.IO) { runCatching { SharedPhoto.prepare(context.contentResolver, uri) }.getOrNull() }
                when {
                    prepared == null -> error = "Couldn't prepare that photo. Try another."
                    !SharedPhoto.isBigEnough(prepared.originalWidth, prepared.originalHeight) ->
                        error = "That photo is too small. Share a bigger one."
                    else -> {
                        graph.api.sharePhoto(mmsi, prepared.jpeg, savedCredit.trim(), note.trim())
                        error = null
                        sent = true
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = graph.describe(e)
            } finally {
                sending = false
            }
        }
    }

    Dialog(
        onDismissRequest = { if (!sending) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false, dismissOnClickOutside = false),
    ) {
        BridgeViewTheme(dark = Theme.colors.isDark) {
            BackHandler(enabled = sending) {}
            Box(Modifier.fillMaxSize()) {
                RiverBackground()
                Column(Modifier.fillMaxSize().imePadding()) {
                    Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (!sent) TextButton(onClick = onDismiss, enabled = !sending) { Text("Cancel") } else Box(Modifier.size(72.dp, 48.dp))
                        Text(
                            "Share a photo",
                            style = Theme.text(Theme.Style.Headline, FontWeight.SemiBold),
                            textAlign = TextAlign.Center,
                            modifier = Modifier.weight(1f),
                        )
                        when {
                            sent -> Box(Modifier.size(72.dp, 48.dp))
                            sending -> Box(Modifier.size(72.dp, 48.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp) }
                            else -> TextButton(onClick = ::send, enabled = image != null && agreed) { Text("Send", fontWeight = FontWeight.SemiBold) }
                        }
                    }
                    if (sent) {
                        Column(Modifier.fillMaxSize().padding(top = 72.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            EmptyState(
                                Icons.Filled.CheckCircle,
                                "Thanks!",
                                "Your photo of $shipName will show once it's been checked.",
                                action = "Done" to onDismiss,
                            )
                        }
                    } else {
                        Column(
                            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 32.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Column(Modifier.readableWidth(), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                                FormSection(
                                    header = shipName,
                                    footer = "A clear shot of the ship works best. Where it was taken and which camera took it are removed before it's sent.",
                                ) {
                                    image?.let { uri ->
                                        AsyncImage(
                                            model = uri,
                                            contentDescription = "The photo you chose",
                                            contentScale = ContentScale.Fit,
                                            modifier = Modifier.fillMaxWidth().heightIn(max = 260.dp).padding(vertical = 8.dp).clip(RoundedCornerShape(8.dp)),
                                        )
                                        Hairline()
                                    }
                                    if (hasCamera) {
                                        ActionRow(Icons.Filled.CameraAlt, if (image == null) "Take a photo" else "Take another", ::takePhoto)
                                        Hairline()
                                    }
                                    ActionRow(Icons.Filled.PhotoLibrary, if (image == null) "Choose from your photos" else "Choose another") {
                                        picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                                    }
                                }
                                FormSection(header = "Credit", footer = "Shown with your photo. Leave it empty and the photo isn't credited.") {
                                    OutlinedTextField(
                                        value = savedCredit,
                                        onValueChange = { graph.prefs.photoCredit.value = it.take(80) },
                                        placeholder = { Text("Your name (optional)") },
                                        singleLine = true,
                                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, autoCorrectEnabled = false),
                                        modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
                                    )
                                }
                                FormSection(header = "Note", footer = "Only BridgeView sees this.") {
                                    OutlinedTextField(
                                        value = note,
                                        onValueChange = { note = it.take(500) },
                                        placeholder = { Text("Anything we should know? (optional)") },
                                        minLines = 1,
                                        maxLines = 4,
                                        modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
                                    )
                                }
                                FormSection(
                                    footer = "Photos are checked before they appear, and may not be used. Sending photos that aren't yours, or that aren't of ships, can get you blocked from sharing.",
                                ) {
                                    Row(
                                        Modifier.fillMaxWidth().clickable(role = Role.Checkbox) { agreed = !agreed }.padding(vertical = 10.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    ) {
                                        Text(
                                            "I took this photo. I keep the copyright, and let BridgeView use it in the app, on its website and anywhere else BridgeView appears, for free and for good.",
                                            style = Theme.text(Theme.Style.Subheadline),
                                            modifier = Modifier.weight(1f),
                                        )
                                        Checkbox(checked = agreed, onCheckedChange = null)
                                    }
                                    Hairline()
                                    Text(
                                        "Read the terms",
                                        color = Theme.colors.signal,
                                        modifier = Modifier.fillMaxWidth().clickable { openUrl(context, AppConfig.page("terms.html")) }.padding(vertical = 14.dp),
                                    )
                                }
                                error?.let {
                                    Card {
                                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            Icon(Icons.Filled.Warning, contentDescription = null, tint = androidx.compose.ui.graphics.Color(0xFFD32F2F))
                                            Text(it, color = androidx.compose.ui.graphics.Color(0xFFD32F2F))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FormSection(header: String? = null, footer: String? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        header?.let { SectionLabel(it, Modifier.padding(horizontal = 12.dp)) }
        Card(padding = 0.dp) { Column(Modifier.padding(horizontal = 16.dp), content = content) }
        footer?.let { Text(it, style = Theme.text(Theme.Style.Footnote), color = Theme.colors.secondaryText, modifier = Modifier.padding(horizontal = 16.dp)) }
    }
}

@Composable
private fun ActionRow(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).padding(vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, contentDescription = null, tint = Theme.colors.signal)
        Text(title, color = Theme.colors.signal, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
