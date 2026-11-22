package mx.boletera.mobile.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.security.MessageDigest

data class IssuedPowChallenge(
    val challengeId: String,
    val salt: String,
    val bits: Int,
)

object HumanChallengeSolver {
    /** Misma regla que HumanChallengeService.leadingZeroBits en el API. */
    fun leadingZeroBits(digest: ByteArray): Int {
        var bits = 0
        for (byte in digest) {
            val value = byte.toInt() and 0xff
            if (value == 0) {
                bits += 8
                continue
            }
            for (i in 7 downTo 0) {
                if ((value shr i) and 1 == 1) return bits
                bits++
            }
        }
        return bits
    }

    suspend fun solvePow(salt: String, challengeId: String, bits: Int): String =
        withContext(Dispatchers.Default) {
            val digest = MessageDigest.getInstance("SHA-256")
            for (counter in 0 until 5_000_000) {
                val counterStr = counter.toString()
                val input = "$salt:$challengeId:$counterStr".toByteArray(Charsets.UTF_8)
                val hash = digest.digest(input)
                if (leadingZeroBits(hash) >= bits) return@withContext counterStr
            }
            throw Exception("Prueba de trabajo no completada en tiempo razonable")
        }

    suspend fun solve(api: ApiClient, sessionId: String?, challenge: IssuedPowChallenge): String {
        val counter = solvePow(challenge.salt, challenge.challengeId, challenge.bits)
        val body = JSONObject()
            .put("challengeId", challenge.challengeId)
            .put("counter", counter)
        if (!sessionId.isNullOrBlank()) body.put("sessionId", sessionId)
        val raw = api.post("inventory/challenge/solve", body, auth = false)
        return JSONObject(raw).optString("clearanceToken").takeIf { it.isNotBlank() }
            ?: throw Exception("No se pudo confirmar el reto.")
    }
}

fun parseChallengeFromBody(raw: String?): IssuedPowChallenge? {
    if (raw.isNullOrBlank()) return null
    // Parser ligero: en unit tests JVM org.json de Android es stub y no sirve.
    val challengeBlock = Regex("\"challenge\"\\s*:\\s*\\{([^}]*)\\}")
        .find(raw)
        ?.groupValues
        ?.getOrNull(1)
        ?: return null
    fun field(name: String): String? =
        Regex("\"$name\"\\s*:\\s*\"([^\"]*)\"")
            .find(challengeBlock)
            ?.groupValues
            ?.getOrNull(1)
            ?.takeIf { it.isNotBlank() }
    fun fieldInt(name: String): Int? =
        Regex("\"$name\"\\s*:\\s*(-?\\d+)")
            .find(challengeBlock)
            ?.groupValues
            ?.getOrNull(1)
            ?.toIntOrNull()
    val id = field("challengeId") ?: return null
    val salt = field("salt") ?: return null
    val bits = fieldInt("bits") ?: return null
    if (bits < 0) return null
    return IssuedPowChallenge(challengeId = id, salt = salt, bits = bits)
}

fun isChallengeRequired(e: Throwable): Boolean {
    val api = e as? ApiException ?: return false
    if (api.code == 428) return true
    val hint = listOfNotNull(api.reason, api.errorCode, api.message).joinToString(" ")
    return hint.contains("HUMAN_CHALLENGE_REQUIRED", ignoreCase = true) ||
        hint.contains("CHALLENGE_REQUIRED", ignoreCase = true)
}
