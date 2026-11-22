package mx.boletera.mobile.data

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.MessageDigest

class HumanChallengeTest {

    @Test
    fun `lightPow devuelve nonce cuyo hash empieza con 00 o fallback`() = runBlocking {
        val nonce = HumanChallengeSolver.lightPow()
        assertTrue(nonce.startsWith("bt-"))
        if (!nonce.startsWith("bt-fallback-")) {
            val hex = MessageDigest.getInstance("SHA-256")
                .digest(nonce.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
            assertTrue("el nonce debe cumplir la prueba de trabajo: $nonce -> $hex", hex.startsWith("00"))
        }
    }

    @Test
    fun `isChallengeRequired reconoce 428`() {
        assertTrue(isChallengeRequired(ApiException(428, "Confirma que eres una persona")))
        assertTrue(
            isChallengeRequired(
                ApiException(400, "reto", reason = "CHALLENGE_REQUIRED", errorCode = "CHALLENGE_REQUIRED"),
            ),
        )
    }
}
