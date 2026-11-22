package mx.boletera.mobile.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject
import java.time.Instant

/**
 * Sesión del comprador (JWT), identidad de invitado y pase de fila por evento.
 * Todo cifrado: el token abre la cartera completa.
 */
class SessionStore(context: Context) {

    private val app = context.applicationContext

    private val prefs: SharedPreferences by lazy {
        val master = MasterKey.Builder(app)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            app,
            "boletera_session",
            master,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun accessToken(): String? = prefs.getString(KEY_ACCESS, null)?.takeIf { it.isNotBlank() }
    fun userEmail(): String? = prefs.getString(KEY_EMAIL, null)
    fun userName(): String? = prefs.getString(KEY_NAME, null)
    fun userId(): String? = prefs.getString(KEY_USER_ID, null)
    fun isLoggedIn(): Boolean = !accessToken().isNullOrBlank()

    fun guestSessionId(): String? = prefs.getString(KEY_GUEST, null)?.takeIf { it.isNotBlank() }

    fun saveLogin(accessToken: String, userId: String, email: String, name: String?) {
        prefs.edit()
            .putString(KEY_ACCESS, accessToken)
            .putString(KEY_USER_ID, userId)
            .putString(KEY_EMAIL, email)
            .putString(KEY_NAME, name)
            .apply()
    }

    fun logout() {
        prefs.edit()
            .remove(KEY_ACCESS)
            .remove(KEY_USER_ID)
            .remove(KEY_EMAIL)
            .remove(KEY_NAME)
            .apply()
    }

    /** Pase de sala de espera atado a la sesión (y al evento). */
    fun queuePass(eventId: String): String? =
        prefs.getString(queueKey(eventId), null)?.takeIf { it.isNotBlank() }

    fun saveQueuePass(eventId: String, pass: String) {
        prefs.edit().putString(queueKey(eventId), pass).apply()
    }

    fun clearQueuePass(eventId: String) {
        prefs.edit().remove(queueKey(eventId)).apply()
    }

    /**
     * Garantiza un `sessionId` de invitado vigente para holds.
     * POST /inventory/session → { sessionId, expiresAt }.
     */
    suspend fun ensureGuestSession(api: ApiClient): String {
        val current = guestSessionId()
        val exp = prefs.getString(KEY_GUEST_EXP, null)
        if (!current.isNullOrBlank() && !exp.isNullOrBlank()) {
            val until = runCatching { Instant.parse(exp) }.getOrNull()
            if (until != null && until.isAfter(Instant.now().plusSeconds(60))) {
                return current
            }
        }
        val raw = api.post("inventory/session", auth = false)
        val o = JSONObject(raw)
        val id = o.getString("sessionId")
        val expires = o.optString("expiresAt").takeIf { it.isNotBlank() }
        prefs.edit()
            .putString(KEY_GUEST, id)
            .putString(KEY_GUEST_EXP, expires)
            .apply()
        return id
    }

    suspend fun login(api: ApiClient, email: String, password: String) {
        val body = JSONObject()
            .put("email", email.trim())
            .put("password", password)
        val raw = api.post("auth/login", body, auth = false)
        val o = JSONObject(raw)
        val token = o.getString("accessToken")
        val user = o.getJSONObject("user")
        val first = user.optString("firstName").orEmpty()
        val last = user.optString("lastName").orEmpty()
        val name = listOf(first, last).filter { it.isNotBlank() }.joinToString(" ").ifBlank { null }
        saveLogin(
            accessToken = token,
            userId = user.getString("id"),
            email = user.getString("email"),
            name = name,
        )
    }

    private fun queueKey(eventId: String) = "queuePass:$eventId"

    private companion object {
        const val KEY_ACCESS = "accessToken"
        const val KEY_USER_ID = "userId"
        const val KEY_EMAIL = "userEmail"
        const val KEY_NAME = "userName"
        const val KEY_GUEST = "guestSessionId"
        const val KEY_GUEST_EXP = "guestExpiresAt"
    }
}
