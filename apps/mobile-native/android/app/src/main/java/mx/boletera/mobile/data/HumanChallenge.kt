package mx.boletera.mobile.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.security.MessageDigest

object HumanChallengeSolver {
    suspend fun lightPow(): String = withContext(Dispatchers.Default) {
        val digest = MessageDigest.getInstance("SHA-256")
        val now = System.currentTimeMillis()
        for (i in 0 until 50000) {
            val nonce = "bt-$now-$i"
            val hex = digest.digest(nonce.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
            if (hex.startsWith("00")) return@withContext nonce
        }
        "bt-fallback-$now"
    }

    suspend fun solve(api: ApiClient, sessionId: String?): String {
        val proof = lightPow()
        val body = JSONObject().put("proof", proof)
        if (!sessionId.isNullOrBlank()) body.put("sessionId", sessionId)
        val raw = api.post("inventory/challenge/solve", body, auth = false)
        return JSONObject(raw).optString("challengeToken").takeIf { it.isNotBlank() }
            ?: throw Exception("No se pudo confirmar el reto.")
    }
}

fun isChallengeRequired(e: Throwable): Boolean {
    val api = e as? ApiException ?: return false
    if (api.code == 428) return true
    val hint = listOfNotNull(api.reason, api.errorCode).joinToString(" ")
    return hint.contains("CHALLENGE_REQUIRED", ignoreCase = true)
}