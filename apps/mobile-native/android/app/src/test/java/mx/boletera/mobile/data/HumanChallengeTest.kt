package mx.boletera.mobile.data

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.MessageDigest

class HumanChallengeTest {

    @Test
    fun `solvePow cumple bits pedidos`() = runBlocking {
        val salt = "abc"
        val challengeId = "def"
        val bits = 8
        val counter = HumanChallengeSolver.solvePow(salt, challengeId, bits)
        val digest = MessageDigest.getInstance("SHA-256")
            .digest("$salt:$challengeId:$counter".toByteArray(Charsets.UTF_8))
        assertTrue(HumanChallengeSolver.leadingZeroBits(digest) >= bits)
    }

    @Test
    fun `parseChallengeFromBody lee challenge del 428`() {
        val raw = """{"code":"HUMAN_CHALLENGE_REQUIRED","challenge":{"challengeId":"c1","salt":"s1","bits":10,"provider":"pow"}}"""
        val parsed = parseChallengeFromBody(raw)
        assertNotNull(parsed)
        assertEquals("c1", parsed!!.challengeId)
        assertEquals("s1", parsed.salt)
        assertEquals(10, parsed.bits)
    }

    @Test
    fun `isChallengeRequired reconoce 428 y HUMAN_CHALLENGE_REQUIRED`() {
        assertTrue(isChallengeRequired(ApiException(428, "Confirma que eres una persona")))
        assertTrue(
            isChallengeRequired(
                ApiException(400, "reto", reason = "HUMAN_CHALLENGE_REQUIRED", errorCode = "HUMAN_CHALLENGE_REQUIRED"),
            ),
        )
    }
}
