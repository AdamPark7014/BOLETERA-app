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
    val errorCode: String? = null,
    val retryAfterSeconds: Int? = null,
    val body: String? = null,
    val challengeToken: String? = null,
) : Exception(message)

/**
 * Cliente HTTP del comprador. Sin Retrofit: pocas rutas, org.json basta.
 * El JWT va en Authorization; la identidad de invitado viaja en el cuerpo
 * (`sessionId`) en holds, no en un header inventado.
 *
 * Ante 503 con saturación espera `Retry-After` (por omisión 2 s) y reintenta.
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

    /** Descarga binaria (PDF de boletos). También reintenta 503. */
    suspend fun getBytes(path: String, auth: Boolean = true): ByteArray =
        withContext(Dispatchers.IO) {
            val url = if (path.startsWith("http")) path else "$base/${path.trimStart('/')}"
            var lastError: ApiException? = null
            for (attempt in 1..4) {
                val builder = Request.Builder().url(url).get()
                    .header("Accept", "application/pdf, application/octet-stream, */*")
                if (auth) {
                    session.accessToken()?.let { builder.header("Authorization", "Bearer $it") }
                }
                http.newCall(builder.build()).execute().use { res ->
                    if (res.code == 503) {
                        val wait = res.header("Retry-After")?.toIntOrNull()?.coerceAtLeast(1) ?: 2
                        lastError = parseError(503, res.body?.string().orEmpty(), wait)
                        Thread.sleep(wait * 1000L)
                        return@use
                    }
                    val bytes = res.body?.bytes() ?: ByteArray(0)
                    if (!res.isSuccessful) throw parseError(res.code, bytes.toString(Charsets.UTF_8))
                    return@withContext bytes
                }
            }
            throw lastError ?: ApiException(
                503,
                "El servidor está saturado. Intenta de nuevo en unos segundos.",
                retryAfterSeconds = 2,
            )
        }

    private suspend fun request(
        method: String,
        path: String,
        body: String?,
        auth: Boolean,
        idempotencyKey: String? = null,
    ): String = withContext(Dispatchers.IO) {
        val url = if (path.startsWith("http")) path else "$base/${path.trimStart('/')}"
        var last503: ApiException? = null
        for (attempt in 1..4) {
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
                if (res.code == 503) {
                    val wait = res.header("Retry-After")?.toIntOrNull()?.coerceAtLeast(1) ?: 2
                    last503 = parseError(503, raw, wait)
                    Thread.sleep(wait * 1000L)
                    return@use
                }
                if (!res.isSuccessful) {
                    val wait = res.header("Retry-After")?.toIntOrNull()
                    throw parseError(res.code, raw, wait)
                }
                return@withContext raw
            }
        }
        throw last503 ?: ApiException(
            503,
            "El servidor está saturado. Intenta de nuevo en unos segundos.",
            retryAfterSeconds = 2,
        )
    }

    companion object {
        fun parseError(code: Int, raw: String, retryAfterSeconds: Int? = null): ApiException {
            val o = runCatching { JSONObject(raw) }.getOrNull()
            val message = o?.optString("message")?.takeIf { it.isNotBlank() }
                ?: when (code) {
                    0 -> "Sin conexión. Revisa tu señal e inténtalo de nuevo."
                    401 -> "Tu sesión venció. Vuelve a entrar."
                    403 -> "No tienes permiso para esto."
                    404 -> "No encontramos eso."
                    409 -> "Eso ya no está disponible."
                    428 -> "Confirma que eres una persona para continuar."
                    429 -> "Demasiados intentos. Espera un momento."
                    503 -> "Hay mucha demanda. Espera un momento e inténtalo de nuevo."
                    in 500..599 -> "El servidor no responde. Inténtalo en un momento."
                    else -> "No se pudo completar (error $code)."
                }
            val errorCode = o?.optString("error")?.takeIf { it.isNotBlank() }
                ?: o?.optString("errorCode")?.takeIf { it.isNotBlank() }
            val reason = o?.optString("reason")?.takeIf { it.isNotBlank() } ?: errorCode
            val challengeToken = o?.optString("challengeToken")?.takeIf { it.isNotBlank() }
            return ApiException(
                code = code,
                message = message,
                reason = reason,
                errorCode = errorCode,
                retryAfterSeconds = retryAfterSeconds,
                body = raw.takeIf { it.isNotBlank() },
                challengeToken = challengeToken,
            )
        }
    }
}
