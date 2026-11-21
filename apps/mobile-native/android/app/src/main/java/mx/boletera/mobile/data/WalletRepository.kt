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
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Cartera del comprador: descarga, guarda cifrada y sirve sin conexión.
 * **Lo guardado siempre gana sobre la red.**
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
        .connectTimeout(6, TimeUnit.SECONDS)
        .readTimeout(6, TimeUnit.SECONDS)
        .build()

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

    fun guardarMine(carteras: List<Wallet>) {
        prefs.edit()
            .putString(KEY_MINE_CACHE, JSONArray().apply {
                carteras.forEach { put(JSONObject(it.toJson())) }
            }.toString())
            .apply()
    }

    fun leerMineLocal(): List<Wallet> {
        val raw = prefs.getString(KEY_MINE_CACHE, null) ?: return emptyList()
        return runCatching {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { Wallet.fromJson(arr.getJSONObject(it).toString()) }
        }.getOrDefault(emptyList())
    }

    suspend fun descargar(publicId: String, accessToken: String?): Wallet =
        withContext(Dispatchers.IO) {
            val url = "${BuildConfig.API_BASE_URL.trimEnd('/')}/orders/$publicId/wallet"
            val req = Request.Builder().url(url).get().apply {
                if (!accessToken.isNullOrBlank()) header("Authorization", "Bearer $accessToken")
            }.build()
            http.newCall(req).execute().use { res ->
                val cuerpo = res.body?.string().orEmpty()
                if (!res.isSuccessful) throw WalletException(mensajeDeError(res.code, cuerpo))
                parseOrderWallet(JSONObject(cuerpo))
            }
        }

    /**
     * Cartera del usuario autenticado: `GET /orders/mine/wallet`.
     * Agrupa por evento; `publicId` sintético `mine:<eventId>` para la lista local.
     */
    suspend fun descargarMine(accessToken: String): List<Wallet> =
        withContext(Dispatchers.IO) {
            val url = "${BuildConfig.API_BASE_URL.trimEnd('/')}/orders/mine/wallet"
            val req = Request.Builder().url(url).get()
                .header("Authorization", "Bearer $accessToken")
                .build()
            http.newCall(req).execute().use { res ->
                val cuerpo = res.body?.string().orEmpty()
                if (!res.isSuccessful) throw WalletException(mensajeDeError(res.code, cuerpo))
                val o = JSONObject(cuerpo)
                val rotation = o.optInt("rotationSeconds", 15)
                val events = o.getJSONArray("events")
                (0 until events.length()).map { i ->
                    val g = events.getJSONObject(i)
                    val e = g.getJSONObject("event")
                    val arr = g.getJSONArray("tickets")
                    val eventId = e.getString("id")
                    Wallet(
                        publicId = "mine:$eventId",
                        rotationSeconds = rotation,
                        event = WalletEvent(
                            id = eventId,
                            title = e.getString("title"),
                            startsAt = e.optStringOrNull("startsAt"),
                            venue = e.optStringOrNull("venue"),
                        ),
                        tickets = (0 until arr.length()).map { j ->
                            Wallet.parseTicket(arr.getJSONObject(j))
                        },
                    )
                }
            }
        }

    suspend fun cargarMine(accessToken: String?): ResultadoLista {
        val local = leerMineLocal()
        if (accessToken.isNullOrBlank()) {
            return ResultadoLista(local, sincronizada = false, aviso = if (local.isEmpty()) null
            else "Sin sesión · se muestran tus copias guardadas")
        }
        return try {
            val fresca = descargarMine(accessToken)
            guardarMine(fresca)
            ResultadoLista(fresca, sincronizada = true, aviso = null)
        } catch (e: Exception) {
            if (local.isNotEmpty()) {
                ResultadoLista(
                    local,
                    sincronizada = false,
                    aviso = "Sin conexión · se muestran tus copias guardadas",
                )
            } else {
                throw if (e is WalletException) e else WalletException(
                    "No se pudieron obtener tus boletos y no hay copia guardada.",
                )
            }
        }
    }

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
    data class ResultadoLista(val carteras: List<Wallet>, val sincronizada: Boolean, val aviso: String?)

    private fun parseOrderWallet(o: JSONObject): Wallet {
        val e = o.getJSONObject("event")
        val arr = o.getJSONArray("tickets")
        val publicId = o.getString("publicId")
        return Wallet(
            publicId = publicId,
            rotationSeconds = o.optInt("rotationSeconds", 15),
            event = WalletEvent(
                id = e.getString("id"),
                title = e.getString("title"),
                startsAt = e.optStringOrNull("startsAt"),
                venue = e.optStringOrNull("venue"),
            ),
            tickets = (0 until arr.length()).map { i ->
                Wallet.parseTicket(arr.getJSONObject(i), orderPublicId = publicId)
            },
        )
    }

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
        const val KEY_MINE_CACHE = "mine_cache"
    }
}

class WalletException(message: String) : Exception(message)
