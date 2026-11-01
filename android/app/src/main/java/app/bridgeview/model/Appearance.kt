package app.bridgeview.model

/** Light, dark or following the system; stored in preferences */
enum class Appearance(val label: String) {
    System("System"), Light("Light"), Dark("Dark");

    val raw: String get() = name.lowercase()

    companion object {
        fun fromRaw(raw: String?): Appearance = entries.firstOrNull { it.raw == raw } ?: System
    }
}
