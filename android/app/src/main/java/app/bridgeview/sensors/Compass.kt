package app.bridgeview.sensors

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.view.Surface
import android.view.WindowManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Which way the phone is pointing, so direction arrows can turn like a compass
 * needle: pointing the way a ship is going as seen by someone holding the phone.
 *
 * Runs only while an arrow is on screen ([start]/[stop] are counted). Magnetic
 * north (a few degrees off here, fine for an arrow); needs no permission.
 */
class Compass(private val context: Context) : SensorEventListener {
    private val manager = context.getSystemService(SensorManager::class.java)
    private val sensor: Sensor? = manager?.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)

    private val _heading = MutableStateFlow<Double?>(null)
    /**
     * Degrees clockwise from north, unwrapped (it can run past 360 or below 0) so an
     * animated arrow turns the short way across north; null when unknown
     */
    val heading: StateFlow<Double?> = _heading.asStateFlow()

    private var users = 0
    private val rotation = FloatArray(9)
    private val remapped = FloatArray(9)
    private val orientation = FloatArray(3)

    fun start() {
        users += 1
        if (users == 1 && sensor != null) {
            manager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_UI)
        }
    }

    fun stop() {
        users = maxOf(0, users - 1)
        if (users > 0) return
        manager?.unregisterListener(this)
        _heading.value = null
    }

    override fun onSensorChanged(event: SensorEvent) {
        SensorManager.getRotationMatrixFromVector(rotation, event.values)
        // The arrow is drawn on the screen, so measure from the screen's top edge
        @Suppress("DEPRECATION")
        val displayRotation = context.getSystemService(WindowManager::class.java)?.defaultDisplay?.rotation ?: Surface.ROTATION_0
        val (x, y) = when (displayRotation) {
            Surface.ROTATION_90 -> SensorManager.AXIS_Y to SensorManager.AXIS_MINUS_X
            Surface.ROTATION_180 -> SensorManager.AXIS_MINUS_X to SensorManager.AXIS_MINUS_Y
            Surface.ROTATION_270 -> SensorManager.AXIS_MINUS_Y to SensorManager.AXIS_X
            else -> SensorManager.AXIS_X to SensorManager.AXIS_Y
        }
        SensorManager.remapCoordinateSystem(rotation, x, y, remapped)
        SensorManager.getOrientation(remapped, orientation)
        val degrees = (Math.toDegrees(orientation[0].toDouble()) + 360) % 360
        update(degrees)
    }

    private fun update(degrees: Double) {
        val current = _heading.value
        if (current == null) {
            _heading.value = degrees
            return
        }
        // Shortest turn from the last reading, so the unwrapped value never jumps a lap
        var delta = (degrees - current) % 360
        if (delta > 180) delta -= 360 else if (delta < -180) delta += 360
        // Ignore jitter under 2 degrees (iOS: headingFilter)
        if (kotlin.math.abs(delta) >= 2) _heading.value = current + delta
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
}
