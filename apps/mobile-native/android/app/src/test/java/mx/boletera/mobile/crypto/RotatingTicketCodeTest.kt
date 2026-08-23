package mx.boletera.mobile.crypto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Contrato entre la app y el servidor.
 *
 * Los vectores NO están escritos a mano: los generó la implementación real de
 * `packages/crypto` (Node) el 2026-08-23. Si esta prueba se pone roja, la app y
 * el escáner han dejado de entenderse y NINGÚN boleto abre la puerta — es el
 * fallo más caro posible en este producto, y no se ve hasta que hay gente
 * esperando fuera.
 *
 * Para regenerarlos tras un cambio deliberado del formato:
 *
 *   node -e "const {createHmac}=require('crypto');
 *     const d=(m,t,e)=>createHmac('sha256',m).update(t+':'+e).digest();
 *     const s=(m,t,e,w)=>createHmac('sha256',d(m,t,e)).update('v2:'+t+':'+e+':'+w).digest('hex').slice(0,32);
 *     console.log(s('secreto-maestro-de-prueba','tkt_abc123','evt_xyz789',0))"
 */
class RotatingTicketCodeTest {

    private data class Vector(
        val claveHex: String,
        val ticketId: String,
        val eventId: String,
        val ventana: Long,
        val firmaEsperada: String,
    )

    private val vectores = listOf(
        Vector(
            "4c8dbecb3a84f5c7f8d1a8794e9b14e834b345053c7114ec90a6e6134de9aa45",
            "tkt_abc123", "evt_xyz789", 0L,
            "814e8396c0c165d586e13e4836563359",
        ),
        Vector(
            "4c8dbecb3a84f5c7f8d1a8794e9b14e834b345053c7114ec90a6e6134de9aa45",
            "tkt_abc123", "evt_xyz789", 118047360L,
            "be2ef029b08fcf2eb60b9531bcbd6426",
        ),
        Vector(
            "dab6f943e0d23d8e090e6b81cc104ab8f52c70f82b209aa91fa5c37cb4f2a26d",
            "tkt_1", "evt_1", 1L,
            "d89aaaffaca24037c9a635f48ee223d4",
        ),
        // Acentos y eñe: el servidor firma en UTF-8 y Kotlin también debe hacerlo.
        // Con ISO-8859-1 este caso pasaría a rojo y los demás no.
        Vector(
            "420fce9d652d0ee693154100eec33ab047e5b418eea6b740ecacb83def9beb69",
            "tkt_ñ-áé", "evt_2026", 99999999L,
            "21fbcf49689796b19e307b22c64ea69b",
        ),
    )

    @Test
    fun `la firma coincide con la del servidor`() {
        for (v in vectores) {
            assertEquals(
                "firma distinta para ${v.ticketId} en la ventana ${v.ventana}",
                v.firmaEsperada,
                RotatingTicketCode.sign(v.claveHex, v.ticketId, v.eventId, v.ventana),
            )
        }
    }

    @Test
    fun `la ventana se calcula igual que en el servidor`() {
        // floor(ms / 15000)
        assertEquals(0L, RotatingTicketCode.windowAt(0L))
        assertEquals(0L, RotatingTicketCode.windowAt(14_999L))
        assertEquals(1L, RotatingTicketCode.windowAt(15_000L))
        assertEquals(118_047_360L, RotatingTicketCode.windowAt(1_770_710_400_000L))
    }

    @Test
    fun `el codigo cambia al cruzar la ventana y no antes`() {
        val v = vectores[0]
        val base = 1_770_710_400_000L // inicio exacto de una ventana
        val dentro = RotatingTicketCode.payload(v.claveHex, v.ticketId, v.eventId, base)
        val casiFuera = RotatingTicketCode.payload(v.claveHex, v.ticketId, v.eventId, base + 14_999L)
        val fuera = RotatingTicketCode.payload(v.claveHex, v.ticketId, v.eventId, base + 15_000L)

        assertEquals("dentro de la misma ventana el código no debe cambiar", dentro, casiFuera)
        assertTrue("al cruzar la ventana el código debe cambiar", dentro != fuera)
    }

    @Test
    fun `el payload tiene el formato que espera el escaner`() {
        val v = vectores[0]
        val payload = RotatingTicketCode.payload(v.claveHex, v.ticketId, v.eventId, 0L)
        assertEquals(
            """{"v":2,"t":"tkt_abc123","e":"evt_xyz789","s":"v2.${v.firmaEsperada}"}""",
            payload,
        )
    }

    @Test
    fun `la cuenta atras nunca es cero ni mayor que la ventana`() {
        for (ms in listOf(0L, 1L, 7_500L, 14_999L, 15_000L, 1_770_710_407_321L)) {
            val restante = RotatingTicketCode.millisUntilNextWindow(ms)
            assertTrue("restante fuera de rango en $ms: $restante", restante in 1..15_000)
        }
    }
}
