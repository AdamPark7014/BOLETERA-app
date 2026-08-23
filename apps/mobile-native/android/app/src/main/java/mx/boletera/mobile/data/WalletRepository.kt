package mx.boletera.mobile.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import mx.boletera.mobile.BuildConfig
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Cartera del comprador: descarga, guarda cifrada y sirve sin conexión.
 *
 * ── La regla que manda ──
 *
 * **Lo guardado siempre gana sobre la red.** La app se usa haciendo fila en una
 * puerta, con veinte mil personas saturando la misma antena. Si la única forma
 * de enseñar el boleto fuera una petición HTTP, la app fallaría exactamente
 * cuando más falta hace. Por eso `cargar()` devuelve lo local de inmediato y la
 * red solo sirve para refrescar.
 *
 * ── Por qué cifrado ──
 *
 * `signingKey` ES la entrada al evento. En `SharedPreferences` normales queda en
 * claro y cualquier app con root —o una copia de seguridad— se la lleva. Con
 * `EncryptedSharedPreferences` la clave vive en el Keystore del dispositivo.
 */
class WalletRepository(context: Context) {

    private val appContext = context.applicationContext

    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(appContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            appContext,
            "boletera_wallet",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    private val http = OkHttpClient.Builder()
        // Corto a propósito: en la puerta, esperar 30 s a una red saturada es
        // peor que usar de inmediato lo que ya está guardado.
        .connectTimeout(6, TimeUnit.SECONDS)
        .readTimeout(6, TimeUnit.SECONDS)
        .build()

    /** Órdenes que el usuario ha añadido, para poder refrescarlas todas. */
    fun ordenesGuardadas(): List<String> =
        prefs.getStringSet(KEY_ORDENES, emptySet())?.sorted() ?: emptyList()

    fun leerLocal(publicId: String): Wallet? =
        prefs.getString(claveCartera(publicId), null)?.let {
            runCatching { Wallet.fromJson(it) }.getOrNull()
        }

    fun guardar(wallet: Wallet) {
        prefs.edit()
            .putString(claveCartera(wallet.publicId), wallet.toJson())
            .putStringSet(KEY_ORDENES, ordenesGuardadas().toMutableSet().apply { add(wallet.publicId) })
            .apply()
    }

    fun olvidar(publicId: String) {
        prefs.edit()
            .remove(claveCartera(publicId))
            .putStringSet(KEY_ORDENES, ordenesGuardadas().toMutableSet().apply { remove(publicId) })
            .apply()
    }

    /**
     * Trae la cartera del servidor. Lanza si no se puede: quien llama decide si
     * eso importa (al añadir una orden sí; al refrescar en la fila, no).
     */
    suspend fun descargar(publicId: String, accessToken: String?): Wallet =
        withContext(Dispatchers.IO) {
            val url = buildString {
                append(BuildConfig.API_BASE_URL.trimEnd('/'))
                append("/orders/")
                append(publicId)
                append("/wallet")
                // El token va en la cabecera, no en la URL: las URLs acaban en
                // logs de proxys y en el historial.
            }
            val req = Request.Builder().url(url).get().apply {
                if (!accessToken.isNullOrBlank()) header("Authorization", "Bearer $accessToken")
            }.build()

            http.newCall(req).execute().use { res ->
                val cuerpo = res.body?.string().orEmpty()
                if (!res.isSuccessful) {
                    throw WalletException(mensajeDeError(res.code, cuerpo))
                }
                val o = JSONObject(cuerpo)
                val e = o.getJSONObject("event")
                val arr = o.getJSONArray("tickets")
                Wallet(
                    publicId = o.getString("publicId"),
                    rotationSeconds = o.optInt("rotationSeconds", 15),
                    event = WalletEvent(
                        id = e.getString("id"),
                        title = e.getString("title"),
                        startsAt = e.optStringOrNull("startsAt"),
                        venue = e.optStringOrNull("venue"),
                    ),
                    tickets = (0 until arr.length()).map { i ->
                        val t = arr.getJSONObject(i)
                        WalletTicket(
                            id = t.getString("id"),
                            code = t.getString("code"),
                            section = t.optStringOrNull("section"),
                            row = t.optStringOrNull("row"),
                            seatNumber = t.optStringOrNull("seatNumber"),
                            status = t.optString("status", "SOLD"),
                            signingKey = t.getString("signingKey"),
                        )
                    },
                )
            }
        }

    /**
     * Lo guardado primero, y la red después solo para refrescar.
     *
     * Si la descarga falla pero hay copia local, NO se propaga el error: el
     * comprador tiene su boleto y no necesita saber que el wifi del recinto va
     * mal. Solo se avisa cuando no hay nada que enseñar.
     */
    suspend fun cargar(publicId: String, accessToken: String?): Resultado {
        val local = leerLocal(publicId)
        return try {
            val fresca = descargar(publicId, accessToken)
            guardar(fresca)
            Resultado(fresca, sincronizada = true, aviso = null)
        } catch (e: Exception) {
            if (local != null) {
                Resultado(local, sincronizada = false, aviso = "Sin conexión · mostrando tu copia guardada")
            } else {
                throw if (e is WalletException) e else WalletException(
                    "No se pudo obtener el boleto y no hay copia guardada en este teléfono.",
                )
            }
        }
    }

    data class Resultado(val wallet: Wallet, val sincronizada: Boolean, val aviso: String?)

    private fun mensajeDeError(codigo: Int, cuerpo: String): String = when (codigo) {
        401, 403 -> "Este boleto no es de esta cuenta. Revisa el código de la orden."
        404 -> "No encontramos esa orden. Comprueba el código."
        400 -> runCatching { JSONObject(cuerpo).optString("message") }
            .getOrNull()?.takeIf { it.isNotBlank() }
            ?: "La orden todavía no está pagada."
        in 500..599 -> "El servidor no responde. Tu copia guardada sigue sirviendo."
        else -> "No se pudo obtener el boleto (error $codigo)."
    }

    private fun claveCartera(publicId: String) = "cartera:$publicId"

    private companion object {
        const val KEY_ORDENES = "ordenes"
    }
}

class WalletException(message: String) : Exception(message)
