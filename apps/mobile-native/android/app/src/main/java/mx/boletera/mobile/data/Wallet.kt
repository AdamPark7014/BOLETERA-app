package mx.boletera.mobile.data

import org.json.JSONArray
import org.json.JSONObject

/**
 * Modelo de la cartera. Refleja `GET /orders/:publicId/wallet`.
 *
 * Se parsea a mano con `org.json` en vez de traer una librería de serialización:
 * son cuatro campos, el formato lo controlamos nosotros, y cada dependencia en
 * una app que debe funcionar sin red es una cosa más que puede fallar.
 */

data class WalletTicket(
    val id: String,
    val code: String,
    val section: String?,
    val row: String?,
    val seatNumber: String?,
    val status: String,
    /**
     * Clave por boleto con la que se firma el QR rotativo.
     *
     * ES LA CREDENCIAL DE ENTRADA. No debe salir del almacenamiento cifrado, ni
     * escribirse en logs, ni mostrarse en pantalla.
     */
    val signingKey: String,
) {
    /** "Platea · Fila B · Asiento 12", saltando lo que no aplique. */
    val ubicacion: String
        get() = listOfNotNull(
            section?.takeIf { it.isNotBlank() },
            row?.takeIf { it.isNotBlank() }?.let { "Fila $it" },
            seatNumber?.takeIf { it.isNotBlank() }?.let { "Asiento $it" },
        ).joinToString(" · ").ifBlank { "Admisión general" }

    /** Solo un boleto vendido y sin usar abre la puerta. */
    val esUtilizable: Boolean
        get() = status.equals("SOLD", ignoreCase = true)
}

data class WalletEvent(
    val id: String,
    val title: String,
    val startsAt: String?,
    val venue: String?,
)

data class Wallet(
    val publicId: String,
    val event: WalletEvent,
    val rotationSeconds: Int,
    val tickets: List<WalletTicket>,
) {
    fun toJson(): String = JSONObject().apply {
        put("publicId", publicId)
        put("rotationSeconds", rotationSeconds)
        put("event", JSONObject().apply {
            put("id", event.id)
            put("title", event.title)
            put("startsAt", event.startsAt ?: JSONObject.NULL)
            put("venue", event.venue ?: JSONObject.NULL)
        })
        put("tickets", JSONArray().apply {
            tickets.forEach { t ->
                put(JSONObject().apply {
                    put("id", t.id)
                    put("code", t.code)
                    put("section", t.section ?: JSONObject.NULL)
                    put("row", t.row ?: JSONObject.NULL)
                    put("seatNumber", t.seatNumber ?: JSONObject.NULL)
                    put("status", t.status)
                    put("signingKey", t.signingKey)
                })
            }
        })
    }.toString()

    companion object {
        fun fromJson(raw: String): Wallet {
            val o = JSONObject(raw)
            val e = o.getJSONObject("event")
            val arr = o.getJSONArray("tickets")
            return Wallet(
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
}

/** `optString` devuelve "null" como texto cuando el valor es JSON null. */
internal fun JSONObject.optStringOrNull(key: String): String? {
    if (!has(key) || isNull(key)) return null
    return optString(key).takeIf { it.isNotBlank() }
}
