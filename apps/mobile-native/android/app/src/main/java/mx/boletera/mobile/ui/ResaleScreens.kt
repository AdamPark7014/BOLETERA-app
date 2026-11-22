package mx.boletera.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mx.boletera.mobile.data.ResaleCheckout
import mx.boletera.mobile.data.ResaleListing
import mx.boletera.mobile.data.WalletTicket
import org.json.JSONArray
import java.text.NumberFormat
import java.util.Locale

private val mxn = NumberFormat.getCurrencyInstance(Locale("es", "MX"))

@Composable
fun ResaleScreen(
    listings: List<ResaleListing>,
    sales: JSONArray?,
    loggedIn: Boolean,
    cargando: Boolean,
    error: String?,
    lastCheckout: ResaleCheckout?,
    sellable: List<WalletTicket>,
    clabeMasked: String?,
    clabeMsg: String?,
    clabeBusy: Boolean,
    onRefresh: () -> Unit,
    onBuy: (String) -> Unit,
    onSell: (ticketId: String, price: Double) -> Unit,
    onSaveClabe: (String) -> Unit,
    onLoginHint: () -> Unit,
) {
    var tab by remember { mutableIntStateOf(0) }
    var priceText by remember { mutableStateOf("") }
    var selectedTicket by remember { mutableStateOf<WalletTicket?>(null) }
    var clabeInput by remember { mutableStateOf("") }

    Column(Modifier.fillMaxSize().background(Marca.Fondo).padding(horizontal = 20.dp)) {
        Spacer(Modifier.height(20.dp))
        Text("Reventa oficial", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Marca.Tinta)
        Text("Verificado · QR nuevo al comprar", fontSize = 13.sp, color = Marca.TintaSuave)
        Spacer(Modifier.height(12.dp))
        Row {
            FilterChip(
                selected = tab == 0,
                onClick = { tab = 0 },
                label = { Text("Comprar") },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = Marca.Dorado,
                    selectedLabelColor = Marca.Negro,
                ),
            )
            Spacer(Modifier.width(8.dp))
            FilterChip(
                selected = tab == 1,
                onClick = { tab = 1 },
                label = { Text("Vender") },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = Marca.Dorado,
                    selectedLabelColor = Marca.Negro,
                ),
            )
            Spacer(Modifier.width(8.dp))
            FilterChip(
                selected = tab == 2,
                onClick = { tab = 2 },
                label = { Text("Mis ventas") },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = Marca.Dorado,
                    selectedLabelColor = Marca.Negro,
                ),
            )
        }
        error?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, color = Marca.Peligro, fontSize = 13.sp)
        }
        lastCheckout?.let {
            Spacer(Modifier.height(8.dp))
            Text("Compra ${it.publicId}: ${it.status}", color = Marca.Exito, fontSize = 13.sp)
            it.redirectUrl?.let { url ->
                val ctx = androidx.compose.ui.platform.LocalContext.current
                TextButton(onClick = { openCustomTab(ctx, url) }) {
                    Text("Continuar pago", color = Marca.Dorado)
                }
            }
        }

        when (tab) {
            0 -> {
                if (cargando) {
                    CircularProgressIndicator(color = Marca.Dorado, modifier = Modifier.padding(24.dp))
                } else {
                    LazyColumn(
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                        contentPadding = PaddingValues(top = 12.dp, bottom = 88.dp),
                    ) {
                        items(listings, key = { it.id }) { item ->
                            Surface(shape = RoundedCornerShape(14.dp), color = Marca.Carbon, modifier = Modifier.fillMaxWidth()) {
                                Column(Modifier.padding(14.dp)) {
                                    Text(item.eventTitle ?: "Evento", fontWeight = FontWeight.SemiBold, color = Marca.Tinta)
                                    item.seatLabel?.let { Text(it, fontSize = 13.sp, color = Marca.TintaSuave) }
                                    Text(mxn.format(item.askingPrice), color = Marca.Dorado, fontWeight = FontWeight.Bold)
                                    Spacer(Modifier.height(8.dp))
                                    Button(
                                        onClick = {
                                            if (!loggedIn) onLoginHint() else onBuy(item.id)
                                        },
                                        colors = ButtonDefaults.buttonColors(
                                            containerColor = Marca.Dorado,
                                            contentColor = Marca.Negro,
                                        ),
                                    ) { Text("Comprar") }
                                }
                            }
                        }
                        item {
                            TextButton(onClick = onRefresh) { Text("Actualizar", color = Marca.TintaSuave) }
                        }
                    }
                }
            }
            1 -> {
                if (!loggedIn) {
                    Text("Entra a tu cuenta para vender un boleto.", color = Marca.TintaSuave)
                    TextButton(onClick = onLoginHint) { Text("Ir a cuenta", color = Marca.Dorado) }
                } else if (sellable.isEmpty()) {
                    Text("No tienes boletos vendibles en este teléfono.", color = Marca.TintaSuave)
                } else {
                    LazyColumn(
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        contentPadding = PaddingValues(top = 12.dp, bottom = 88.dp),
                    ) {
                        items(sellable, key = { it.id }) { t ->
                            val active = selectedTicket?.id == t.id
                            Surface(
                                shape = RoundedCornerShape(12.dp),
                                color = if (active) Marca.Dorado.copy(alpha = 0.15f) else Marca.Carbon,
                                onClick = { selectedTicket = t },
                            ) {
                                Column(Modifier.padding(12.dp)) {
                                    Text(t.ubicacion, color = Marca.Tinta)
                                    Text(t.code, color = Marca.TintaSuave, fontSize = 12.sp)
                                }
                            }
                        }
                        item {
                            OutlinedTextField(
                                value = priceText,
                                onValueChange = { priceText = it.filter { c -> c.isDigit() || c == '.' } },
                                label = { Text("Precio pedido (MXN)") },
                                colors = btFieldColors(),
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Spacer(Modifier.height(8.dp))
                            Button(
                                onClick = {
                                    val t = selectedTicket ?: return@Button
                                    val p = priceText.toDoubleOrNull() ?: return@Button
                                    onSell(t.id, p)
                                },
                                enabled = selectedTicket != null && (priceText.toDoubleOrNull() ?: 0.0) > 0,
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = Marca.Dorado,
                                    contentColor = Marca.Negro,
                                ),
                                modifier = Modifier.fillMaxWidth().height(48.dp),
                            ) { Text("Publicar anuncio") }
                        }
                    }
                }
            }
            else -> {
                if (!loggedIn) {
                    Text("Entra para ver tus ventas.", color = Marca.TintaSuave)
                } else {
                    LazyColumn(contentPadding = PaddingValues(top = 12.dp, bottom = 88.dp)) {
                        item {
                            Surface(
                                shape = RoundedCornerShape(14.dp),
                                color = Marca.Carbon,
                                modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
                            ) {
                                Column(Modifier.padding(14.dp)) {
                                    Text("CLABE para depósito", fontWeight = FontWeight.SemiBold, color = Marca.Tinta)
                                    Text(
                                        clabeMsg
                                            ?: if (clabeMasked != null) "Guardada: $clabeMasked. Estado del depósito en cada venta."
                                            else "La usamos solo para depositarte lo de tus ventas.",
                                        fontSize = 12.sp,
                                        color = Marca.TintaSuave,
                                    )
                                    Spacer(Modifier.height(8.dp))
                                    OutlinedTextField(
                                        value = clabeInput,
                                        onValueChange = {
                                            clabeInput = it.filter { c -> c.isDigit() }.take(18)
                                        },
                                        label = { Text("18 dígitos") },
                                        placeholder = { Text(clabeMasked ?: "CLABE") },
                                        singleLine = true,
                                        colors = btFieldColors(),
                                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                        modifier = Modifier.fillMaxWidth(),
                                    )
                                    Spacer(Modifier.height(8.dp))
                                    Button(
                                        onClick = { onSaveClabe(clabeInput) },
                                        enabled = !clabeBusy && clabeInput.length == 18,
                                        colors = ButtonDefaults.buttonColors(
                                            containerColor = Marca.Dorado,
                                            contentColor = Marca.Negro,
                                        ),
                                        modifier = Modifier.fillMaxWidth().height(48.dp),
                                    ) {
                                        Text(if (clabeBusy) "Guardando…" else "Guardar CLABE")
                                    }
                                }
                            }
                        }
                        if (sales == null || sales.length() == 0) {
                            item {
                                Text("Aún no tienes ventas en reventa.", color = Marca.TintaSuave)
                            }
                        } else {
                            items(sales.length()) { i ->
                                val o = sales.getJSONObject(i)
                                val payout = o.optJSONObject("payout")
                                val payoutStatus = payout?.optString("status")
                                    ?: o.optString("payoutStatus", o.optString("status"))
                                val payoutLabel = when (payoutStatus.uppercase()) {
                                    "PAID" -> "Depositado"
                                    "PENDING" -> "Depósito en proceso"
                                    else -> payoutStatus
                                }
                                Surface(
                                    shape = RoundedCornerShape(12.dp),
                                    color = Marca.Carbon,
                                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                                ) {
                                    Column(Modifier.padding(12.dp)) {
                                        Text(
                                            o.optJSONObject("event")?.optString("title")
                                                ?: o.optString("eventTitle", o.optString("status", "Venta")),
                                            color = Marca.Tinta,
                                            fontWeight = FontWeight.SemiBold,
                                        )
                                        Text("Estado del anuncio: ${o.optString("status")}", color = Marca.TintaSuave, fontSize = 13.sp)
                                        Text("Pago: $payoutLabel", color = Marca.DoradoSuave, fontSize = 13.sp)
                                        val price = when {
                                            payout != null && payout.has("amount") -> payout.optDouble("amount", 0.0)
                                            o.has("askingPrice") -> o.optDouble("askingPrice", 0.0)
                                            else -> o.optDouble("sellerPayout", 0.0)
                                        }
                                        if (price > 0) Text(mxn.format(price), color = Marca.Dorado)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
