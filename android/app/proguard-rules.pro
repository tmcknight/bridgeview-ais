# kotlinx.serialization, OkHttp, Coil, MapLibre and Firebase ship their own consumer rules.
# Keep @Serializable classes' companions (serializer lookup) in case R8 gets aggressive.
-keepclassmembers @kotlinx.serialization.Serializable class app.bridgeview.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
