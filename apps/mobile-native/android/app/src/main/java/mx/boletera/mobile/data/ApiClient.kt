package mx.boletera.mobile.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import mx.boletera.mobile.BuildConfig
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Error HTTP de la API con mensaje en español cuando el servidor lo manda. */
class ApiException(
    val code: Int,
    override val message: String,
    val reason: String? = null,
) : Exception(message)

/**
 * Cliente HTTP del comprador. Sin Retrofit: pocas rutas, org.json basta.
 * El JWT va en Authorization; la identidad de invitado viaja en el cuerpo
 * (`sessionId`) en holds, no en un header inventado.
 */
class ApiClient(private val session: SessionStore) {

    private val jsonType = "application/json; charset=utf-8".toMediaType()

    private val http = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(12, TimeUnit.SECONDS)
        .writeTimeout(12, TimeUnit.SECONDS)
        .build()

    private val base: String
        get() = BuildConfig.API_BASE_URL.trimEnd('/')

    suspend fun get(path: String, auth: Boolean = true): String =
        request("GET", path, body = null, auth = auth)

    suspend fun post(
        path: String,
        json: JSONObject? = null,
        auth: Boolean = true,
        idempotencyKey: String? = null,
    ): String = request("POST", path, json?.toString(), auth, idempotencyKey)

    suspend fun patch(
        path: String,
        json: JSONObject? = null,
        auth: Boolean = true,
    ): String = request("PATCH", path, json?.toString(), auth)

    suspend fun delete(
        path: String,
        json: JSONObject? = null,
        auth: Boolean = true,
    ): String = request("DELETE", path, json?.toString(), auth)

    private suspend fun request(
        method: String,
        path: String,
        body: String?,
        auth: Boolean,
        idempotencyKey: String? = null,
    ): String = withContext(Dispatchers.IO) {
        val url = if (path.startsWith("http")) path else "$base/${path.trimStart('/')}"
        val builder = Request.Builder().url(url)
        val media = body?.toRequestBody(jsonType)
        when (method) {
            "GET" -> builder.get()
            "POST" -> builder.post(media ?: "".toRequestBody(jsonType))
            "PATCH" -> builder.patch(media ?: "".toRequestBody(jsonType))
            "DELETE" -> if (media != null) builder.delete(media) else builder.delete()
            else -> error("Método no soportado: $method")
        }
        builder.header("Accept", "application/json")
        if (auth) {
            session.accessToken()?.let { builder.header("Authorization", "Bearer $it") }
        }
        idempotencyKey?.takeIf { it.isNotBlank() }?.let {
            builder.header("Idempotency-Key", it)
        }
        http.newCall(builder.build()).execute().use { res ->
            val raw = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw parseError(res.code, raw)
            raw
        }
    }

    companion object {
        fun parseError(code: Int, raw: String): ApiException {
            val o = runCatching { JSONObject(raw) }.getOrNull()
            val message = o?.optString("message")?.takeIf { it.isNotBlank() }
                ?: when (code) {
                    0 -> "Sin conexión. Revisa tu señal e inténtalo de nuevo."
                    401 -> "Tu sesión venció. Vuelve a entrar."
                    403 -> "No tienes permiso para esto."
                    404 -> "No encontramos eso."
                    409 -> "Eso ya no está disponible."
                    429 -> "Demasiados intentos. Espera un momento."
                    in 500..599 -> "El servidor no responde. Inténtalo en un momento."
                    else -> "No se pudo completar (error $code)."
                }
            val reason = o?.optString("reason")?.takeIf { it.isNotBlank() }
                ?: o?.optString("error")?.takeIf { it.isNotBlank() }
            return ApiException(code, message, reason)
        }
    }
}
