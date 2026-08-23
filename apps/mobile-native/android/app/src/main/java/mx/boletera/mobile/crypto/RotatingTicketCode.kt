package mx.boletera.mobile.crypto

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Código rotativo del boleto, generado EN EL DISPOSITIVO.
 *
 * ── Por qué vive aquí y no en el servidor ──
 *
 * El QR cambia cada 15 s: una captura de pantalla reenviada por WhatsApp no
 * sirve para entrar. Pero si el código lo firmara el servidor, el comprador
 * necesitaría cobertura justo en la puerta — y la puerta es exactamente donde
 * peor la hay: veinte mil personas en el mismo sitio saturan la red móvil y la
 * fila se detiene.
 *
 * El teléfono recibe la clave derivada de SU boleto (`signingKey`) y calcula
 * cada ventana en local. Sin red, sin latencia, sin fila parada.
 *
 * ── Por qué esto es seguro ──
 *
 * La clave NO es el secreto maestro del sistema: el servidor entrega
 * `HMAC(maestro, "ticketId:eventId")`. Con ella solo se puede firmar ESE boleto.
 * Un teléfono robado o rooteado expone una entrada, no la boletera.
 *
 * ── Contrato con el servidor (packages/crypto/src/index.ts) ──
 *
 * Cualquier cambio aquí debe reflejarse allí, o los códigos dejan de validar:
 *
 *   ventana  = floor(ahoraMs / 15000)
 *   firma    = HMAC_SHA256(claveBoleto, "v2:<ticketId>:<eventId>:<ventana>")
 *              truncada a los primeros 32 caracteres hexadecimales
 *   payload  = {"v":2,"t":<ticketId>,"e":<eventId>,"s":"v2.<firma>"}
 *
 * El escáner acepta la ventana actual y la anterior (30 s de gracia), lo que
 * absorbe el desfase de reloj razonable entre teléfono y servidor.
 */
object RotatingTicketCode {

    /** Duración de cada ventana. El servidor usa el mismo valor. */
    const val ROTATION_SECONDS = 15

    /**
     * La firma se trunca a 32 hex (128 bits) para que el QR quepa en una versión
     * baja y se lea rápido con poca luz y una pantalla sucia. Es de sobra: la
     * ventana dura 30 s y cada intento fallido queda registrado.
     */
    private const val SIGNATURE_HEX_LENGTH = 32

    private const val V2_PREFIX = "v2."

    /** Ventana temporal vigente. */
    fun windowAt(nowMillis: Long): Long = nowMillis / (ROTATION_SECONDS * 1000L)

    /** Milisegundos que faltan para que el código cambie. Alimenta la cuenta atrás. */
    fun millisUntilNextWindow(nowMillis: Long): Long {
        val periodo = ROTATION_SECONDS * 1000L
        return periodo - (nowMillis % periodo)
    }

    /**
     * Firma de una ventana concreta.
     *
     * @param signingKeyHex clave por boleto que entregó el servidor, en hexadecimal.
     */
    fun sign(signingKeyHex: String, ticketId: String, eventId: String, window: Long): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(hexToBytes(signingKeyHex), "HmacSHA256"))
        val digest = mac.doFinal("v2:$ticketId:$eventId:$window".toByteArray(Charsets.UTF_8))
        return bytesToHex(digest).take(SIGNATURE_HEX_LENGTH)
    }

    /**
     * Payload completo del QR para este instante.
     *
     * El JSON se arma a mano y con las claves en el mismo orden que el servidor:
     * el escáner lo parsea, así que el orden no es crítico, pero mantenerlo
     * idéntico hace que un byte de diferencia salte a la vista al depurar.
     */
    fun payload(
        signingKeyHex: String,
        ticketId: String,
        eventId: String,
        nowMillis: Long,
    ): String {
        val firma = V2_PREFIX + sign(signingKeyHex, ticketId, eventId, windowAt(nowMillis))
        return """{"v":2,"t":${quote(ticketId)},"e":${quote(eventId)},"s":${quote(firma)}}"""
    }

    // --- utilidades ---------------------------------------------------------

    private fun quote(value: String): String {
        val sb = StringBuilder(value.length + 2)
        sb.append('"')
        for (c in value) {
            when (c) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                else -> sb.append(c)
            }
        }
        sb.append('"')
        return sb.toString()
    }

    private fun hexToBytes(hex: String): ByteArray {
        require(hex.length % 2 == 0) { "La clave del boleto debe tener un número par de dígitos" }
        return ByteArray(hex.length / 2) { i ->
            ((hexDigit(hex[i * 2]) shl 4) or hexDigit(hex[i * 2 + 1])).toByte()
        }
    }

    private fun hexDigit(c: Char): Int = when (c) {
        in '0'..'9' -> c - '0'
        in 'a'..'f' -> c - 'a' + 10
        in 'A'..'F' -> c - 'A' + 10
        else -> throw IllegalArgumentException("Dígito hexadecimal inválido: $c")
    }

    private val HEX = "0123456789abcdef".toCharArray()

    private fun bytesToHex(bytes: ByteArray): String {
        val out = CharArray(bytes.size * 2)
        for (i in bytes.indices) {
            val v = bytes[i].toInt() and 0xFF
            out[i * 2] = HEX[v ushr 4]
            out[i * 2 + 1] = HEX[v and 0x0F]
        }
        return String(out)
    }
}
