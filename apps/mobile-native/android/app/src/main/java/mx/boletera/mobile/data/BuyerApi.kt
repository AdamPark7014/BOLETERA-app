package mx.boletera.mobile.data

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/* ── Modelos del comprador (espejo de lo que ya da el API) ── */

data class CatalogEvent(
    val id: String,
    val slug: String,
    val title: String,
    val startsAt: String?,
    val venueName: String?,
    val city: String?,
    val image: String?,
    val minPriceAllIn: Double,
    val currency: String,
    val offers: List<OfferCard>,
)

data class OfferCard(
    val id: String,
    val name: String,
    val zone: String?,
    val basePrice: Double,
    val allInPrice: Double,
    val remainingQuantity: Int?,
    val isAvailable: Boolean,
) {
    val agotada: Boolean
        get() = !isAvailable || (remainingQuantity != null && remainingQuantity <= 0)
}

data class HoldResult(
    val holdIds: List<String>,
    val expiresAt: String?,
    val seatLabels: List<String>,
)

data class PaymentAction(
    val gateway: String?,
    val intentId: String?,
    val redirectUrl: String?,
    val reference: String?,
    val clabe: String?,
    val concept: String?,
    val status: String?,
)

data class CreatedOrder(
    val publicId: String,
    val accessToken: String?,
    val totalAmount: String?,
    val paymentAction: PaymentAction?,
)

data class PaymentConfig(
    val methods: List<String>,
    val demo: Boolean,
    val msiMinTotal: Double,
)

data class ResaleListing(
    val id: String,
    val askingPrice: Double,
    val currency: String,
    val eventTitle: String?,
    val seatLabel: String?,
    val status: String?,
)

data class ResaleCheckout(
    val publicId: String,
    val status: String,
    val redirectUrl: String?,
    val reference: String?,
)

data class WaitlistClaim(
    val token: String,
    val eventTitle: String?,
    val expiresAt: String?,
    val status: String?,
    val holdIds: List<String>,
    val offerId: String?,
    val eventId: String?,
)

/**
 * Todas las rutas del comprador que la web ya usa. La regla de negocio vive
 * en el API; aquí solo se consume y se traduce a modelos.
 */
class BuyerApi(
    private val api: ApiClient,
    private val session: SessionStore,
) {

    suspend fun listEvents(query: String? = null, limit: Int = 40): List<CatalogEvent> {
        val q = buildString {
            append("discovery/events?limit=$limit")
            if (!query.isNullOrBlank()) append("&q=${java.net.URLEncoder.encode(query.trim(), "UTF-8")}")
        }
        val raw = api.get(q, auth = false)
        val arr = JSONArray(raw)
        return (0 until arr.length()).map { parseCatalogEvent(arr.getJSONObject(it)) }
    }

    suspend fun eventBySlug(slug: String): CatalogEvent {
        val raw = api.get("discovery/events/${slug.trim()}", auth = false)
        return parseCatalogEvent(JSONObject(raw))
    }

    suspend fun createBestAvailableHold(
        eventId: String,
        offerId: String,
        quantity: Int,
        accessCode: String?,
    ): HoldResult {
        val guest = session.ensureGuestSession(api)
        val body = JSONObject()
            .put("eventId", eventId)
            .put("offerId", offerId)
            .put("quantity", quantity)
            .put("contiguous", true)
            .put("sessionId", guest)
        if (!accessCode.isNullOrBlank()) body.put("accessCode", accessCode.trim())
        val raw = api.post(
            "inventory/holds/best-available",
            body,
            auth = session.isLoggedIn(),
            idempotencyKey = UUID.randomUUID().toString(),
        )
        return parseHold(raw)
    }

    suspend fun createGaHold(
        eventId: String,
        offerId: String,
        quantity: Int,
        accessCode: String?,
    ): HoldResult {
        val guest = session.ensureGuestSession(api)
        val body = JSONObject()
            .put("eventId", eventId)
            .put("offerId", offerId)
            .put("quantity", quantity)
            .put("sessionId", guest)
        if (!accessCode.isNullOrBlank()) body.put("accessCode", accessCode.trim())
        val raw = api.post(
            "inventory/holds",
            body,
            auth = session.isLoggedIn(),
            idempotencyKey = UUID.randomUUID().toString(),
        )
        return parseHold(raw)
    }

    suspend fun paymentConfig(eventId: String?): PaymentConfig {
        val path = if (eventId.isNullOrBlank()) "payments/config"
        else "payments/config?eventId=$eventId"
        val raw = runCatching { api.get(path, auth = false) }.getOrNull()
        if (raw.isNullOrBlank()) {
            return PaymentConfig(listOf("CARD", "SPEI", "OXXO"), demo = true, msiMinTotal = 1500.0)
        }
        val o = JSONObject(raw)
        val methods = o.optJSONArray("methods")?.let { arr ->
            (0 until arr.length()).mapNotNull { arr.optString(it).takeIf { m -> m.isNotBlank() } }
        } ?: listOf("CARD", "SPEI", "OXXO")
        return PaymentConfig(
            methods = methods,
            demo = o.optBoolean("demo", false),
            msiMinTotal = o.optDouble("msiMinTotal", 1500.0),
        )
    }

    suspend fun createOrder(
        eventId: String,
        holdIds: List<String>,
        offerId: String?,
        buyerName: String,
        buyerEmail: String,
        buyerPhone: String?,
        paymentMethod: String,
        installments: Int?,
    ): CreatedOrder {
        val body = JSONObject()
            .put("eventId", eventId)
            .put("buyerName", buyerName.trim())
            .put("buyerEmail", buyerEmail.trim())
            .put("paymentMethod", paymentMethod)
            .put("holdIds", JSONArray(holdIds))
        if (!offerId.isNullOrBlank()) body.put("offerId", offerId)
        if (!buyerPhone.isNullOrBlank()) body.put("buyerPhone", buyerPhone.trim())
        if (paymentMethod == "CARD" && installments != null && installments > 1) {
            body.put("installments", installments)
        }
        val raw = api.post(
            "orders",
            body,
            auth = session.isLoggedIn(),
            idempotencyKey = "ord-${UUID.randomUUID()}",
        )
        val o = JSONObject(raw)
        val action = o.optJSONObject("paymentAction")
        val meta = action?.optJSONObject("metadata")
        return CreatedOrder(
            publicId = o.getString("publicId"),
            accessToken = o.optStringOrNull("accessToken"),
            totalAmount = o.optStringOrNull("totalAmount"),
            paymentAction = action?.let {
                PaymentAction(
                    gateway = it.optStringOrNull("gateway"),
                    intentId = it.optStringOrNull("intentId"),
                    redirectUrl = it.optStringOrNull("redirectUrl"),
                    reference = it.optStringOrNull("reference"),
                    clabe = meta?.optStringOrNull("clabe"),
                    concept = meta?.optStringOrNull("concept"),
                    status = it.optStringOrNull("status"),
                )
            },
        )
    }

    suspend fun listResale(limit: Int = 40): List<ResaleListing> {
        val raw = api.get("resale/listings?limit=$limit", auth = false)
        val root = JSONObject(raw)
        val arr = when {
            root.has("items") -> root.getJSONArray("items")
            root.has("listings") -> root.getJSONArray("listings")
            else -> JSONArray(raw)
        }
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            val event = o.optJSONObject("event")
            val ticket = o.optJSONObject("ticket")
            ResaleListing(
                id = o.getString("id"),
                askingPrice = o.optDouble("askingPrice", 0.0),
                currency = o.optString("currency", "MXN"),
                eventTitle = event?.optStringOrNull("title") ?: o.optStringOrNull("eventTitle"),
                seatLabel = listOfNotNull(
                    ticket?.optStringOrNull("section"),
                    ticket?.optStringOrNull("row")?.let { "Fila $it" },
                    ticket?.optStringOrNull("seatNumber")?.let { "Asiento $it" },
                ).joinToString(" · ").ifBlank { o.optStringOrNull("seatLabel") },
                status = o.optStringOrNull("status"),
            )
        }
    }

    suspend fun buyResale(listingId: String): ResaleCheckout {
        val raw = api.post("resale/listings/$listingId/buy", JSONObject())
        val o = JSONObject(raw)
        val action = o.optJSONObject("paymentAction")
        return ResaleCheckout(
            publicId = o.optString("publicId", o.optString("id")),
            status = o.optString("status", "PENDING"),
            redirectUrl = action?.optStringOrNull("redirectUrl"),
            reference = action?.optStringOrNull("reference"),
        )
    }

    suspend fun resaleCheckoutStatus(publicId: String): ResaleCheckout {
        val raw = api.get("resale/checkouts/$publicId")
        val o = JSONObject(raw)
        val action = o.optJSONObject("paymentAction")
        return ResaleCheckout(
            publicId = o.optString("publicId", publicId),
            status = o.optString("status", "PENDING"),
            redirectUrl = action?.optStringOrNull("redirectUrl"),
            reference = action?.optStringOrNull("reference"),
        )
    }

    suspend fun myResaleSales(): JSONArray {
        val raw = api.get("resale/mine")
        return runCatching { JSONArray(raw) }.getOrElse {
            JSONObject(raw).optJSONArray("items") ?: JSONArray()
        }
    }

    suspend fun createResaleListing(ticketId: String, askingPrice: Double): JSONObject {
        val body = JSONObject()
            .put("ticketId", ticketId)
            .put("askingPrice", askingPrice)
        return JSONObject(api.post("resale/listings", body))
    }

    suspend fun joinWaitlist(eventId: String, email: String, offerId: String?, quantity: Int): JSONObject {
        val body = JSONObject()
            .put("eventId", eventId)
            .put("email", email.trim())
            .put("quantity", quantity)
        if (!offerId.isNullOrBlank()) body.put("offerId", offerId)
        return JSONObject(api.post("waitlist/join", body, auth = false))
    }

    suspend fun waitlistClaim(token: String): WaitlistClaim {
        val raw = api.get("waitlist/claim/$token", auth = false)
        val o = JSONObject(raw)
        val holds = o.optJSONArray("holdIds") ?: o.optJSONArray("holds")
        val holdIds = if (holds == null) emptyList()
        else (0 until holds.length()).mapNotNull {
            when (val v = holds.get(it)) {
                is String -> v
                is JSONObject -> v.optString("id").takeIf { id -> id.isNotBlank() }
                else -> null
            }
        }
        return WaitlistClaim(
            token = token,
            eventTitle = o.optJSONObject("event")?.optStringOrNull("title")
                ?: o.optStringOrNull("eventTitle"),
            expiresAt = o.optStringOrNull("expiresAt") ?: o.optStringOrNull("claimExpiresAt"),
            status = o.optStringOrNull("status"),
            holdIds = holdIds,
            offerId = o.optStringOrNull("offerId"),
            eventId = o.optStringOrNull("eventId")
                ?: o.optJSONObject("event")?.optStringOrNull("id"),
        )
    }

    suspend fun convertWaitlistClaim(token: String): WaitlistClaim {
        api.post("waitlist/claim/$token/convert", JSONObject(), auth = false)
        return waitlistClaim(token)
    }

    suspend fun transferTicket(ticketId: String, toEmail: String, message: String?) {
        val body = JSONObject()
            .put("ticketId", ticketId)
            .put("toEmail", toEmail.trim())
        if (!message.isNullOrBlank()) body.put("message", message.trim())
        api.post("tickets/transfer", body)
    }

    suspend fun resendTickets(publicId: String, accessToken: String?) {
        val path = buildString {
            append("orders/$publicId/resend")
            if (!accessToken.isNullOrBlank()) {
                append("?accessToken=")
                append(java.net.URLEncoder.encode(accessToken, "UTF-8"))
            }
        }
        api.post(path, JSONObject())
    }

    private fun parseHold(raw: String): HoldResult {
        val o = JSONObject(raw)
        val holds = o.optJSONArray("holds")
        val holdIds = when {
            holds != null -> (0 until holds.length()).map { holds.getJSONObject(it).getString("id") }
            o.has("holdIds") -> {
                val a = o.getJSONArray("holdIds")
                (0 until a.length()).map { a.getString(it) }
            }
            o.has("id") -> listOf(o.getString("id"))
            else -> emptyList()
        }
        val seats = o.optJSONArray("seats")
        val labels = if (seats == null) emptyList()
        else (0 until seats.length()).map { i ->
            val s = seats.getJSONObject(i)
            s.optStringOrNull("label")
                ?: listOfNotNull(
                    s.optStringOrNull("section"),
                    s.optStringOrNull("row")?.let { "Fila $it" },
                    s.optStringOrNull("seatNumber")?.let { "Asiento $it" },
                ).joinToString(" · ").ifBlank { "Lugar ${i + 1}" }
        }
        return HoldResult(
            holdIds = holdIds,
            expiresAt = o.optStringOrNull("expiresAt"),
            seatLabels = labels,
        )
    }

    private fun parseCatalogEvent(o: JSONObject): CatalogEvent {
        val venue = o.optJSONObject("venue")
        val offersArr = o.optJSONArray("offers")
        val offers = if (offersArr == null) emptyList()
        else (0 until offersArr.length()).map { i ->
            val of = offersArr.getJSONObject(i)
            OfferCard(
                id = of.getString("id"),
                name = of.optString("name").ifBlank { of.optString("zone") },
                zone = of.optStringOrNull("zone"),
                basePrice = of.optDouble("basePrice", 0.0),
                allInPrice = of.optDouble("allInPrice", of.optDouble("basePrice", 0.0)),
                remainingQuantity = if (of.has("remainingQuantity") && !of.isNull("remainingQuantity"))
                    of.optInt("remainingQuantity") else null,
                isAvailable = of.optBoolean("isAvailable", true),
            )
        }
        return CatalogEvent(
            id = o.getString("id"),
            slug = o.optString("slug", o.getString("id")),
            title = o.getString("title"),
            startsAt = o.optStringOrNull("startsAt"),
            venueName = venue?.optStringOrNull("name"),
            city = venue?.optStringOrNull("city"),
            image = o.optStringOrNull("image") ?: o.optStringOrNull("bannerImage"),
            minPriceAllIn = o.optDouble("minPriceAllIn", 0.0),
            currency = o.optString("currency", "MXN"),
            offers = offers,
        )
    }
}
