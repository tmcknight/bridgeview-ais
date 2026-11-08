package app.bridgeview.data

import app.bridgeview.model.DeepLink
import kotlinx.coroutines.flow.MutableStateFlow

/** Which screen is showing; notification taps and deep links open a ship */
class Router {
    enum class Tab { Upcoming, Map, Recent, Settings }

    val tab = MutableStateFlow(Tab.Upcoming)

    /** Ship opened from outside the app (notification tap or bridgeview:// link) */
    val openedShip = MutableStateFlow<Int?>(null)

    /** Ship to select on the map (the countdown's Map button); the map clears it */
    val mapShip = MutableStateFlow<Int?>(null)

    /** The ship cam was asked for (the countdown's button); opened once its video is known */
    val camRequested = MutableStateFlow(false)

    fun open(mmsi: Int) {
        openedShip.value = mmsi
    }

    fun open(target: DeepLink.Target) {
        when (target) {
            is DeepLink.Target.Ship -> open(target.mmsi)
            is DeepLink.Target.Map -> {
                openedShip.value = null
                tab.value = Tab.Map
                mapShip.value = target.mmsi
            }
            DeepLink.Target.Cam -> camRequested.value = true
        }
    }
}
