package app.bridgeview.data

import kotlinx.coroutines.flow.MutableStateFlow

/** Which screen is showing; notification taps and deep links open a ship */
class Router {
    enum class Tab { Upcoming, Map, Recent, Settings }

    val tab = MutableStateFlow(Tab.Upcoming)

    /** Ship opened from outside the app (notification tap or bridgeview:// link) */
    val openedShip = MutableStateFlow<Int?>(null)

    fun open(mmsi: Int) {
        openedShip.value = mmsi
    }
}
