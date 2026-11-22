package mx.boletera.mobile.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import mx.boletera.mobile.data.CreatedOrder
import mx.boletera.mobile.data.PaymentConfig
import java.text.NumberFormat
import java.time.Instant
import java.util.Locale

private val mxn = NumberFormat.getCurrencyInstance(Locale("es", "MX"))

@Composable
fun CheckoutScreen(
    eventTitle: String,
    seatSummary: String,
    estimatedTotal: Double,
    expiresAt: String?,
    config: PaymentConfig?,
    defaultName: String,
    defaultEmail: String,
    busy: Boolean,
    error: String?,
    lastOrder: CreatedOrder?,
    onPagar: (name: String, email: String, phone: String, method: String, installments: Int?) -> Unit,
    onVolver: () -> Unit,
    onIrBoletos: () -> Unit,
) {
    val ctx = LocalContext.current
    var name by remember { mutableStateOf(defaultName) }
    var email by remember { mutableStateOf(defaultEmail) }
    var phone by remember { mutableStateOf("") }
    var method by remember { mutableStateOf("CARD") }
    var installments by remember { mutableIntStateOf(1) }
    var locked by remember { mutableStateOf(false) }

    val methods = config?.methods?.ifEmpty { listOf("CARD", "SPEI", "OXXO") }
        ?: listOf("CARD", "SPEI", "OXXO")
    val msiMin = config?.msiMinTotal ?: 1500.0
    val msiPlans = config?.plans?.ifEmpty { listOf(1, 3, 6, 9, 12) } ?: listOf(1, 3, 6, 9, 12)
    val showMsi = method == "CARD" && estimatedTotal >= msiMin

    var remain by remember { mutableIntStateOf(secondsUntil(expiresAt)) }
    LaunchedEffect(expiresAt) {
        while (true) {
            remain = secondsUntil(expiresAt)
            delay(1000)
        }
    }
    val expired = remain <= 0 && !expiresAt.isNullOrBlank()

    LaunchedEffect(lastOrder) {
        val action = lastOrder?.paymentAction ?: return@LaunchedEffect
        val url = action.redirectUrl
        if (!url.isNullOrBlank()) {
            openCustomTab(ctx, url)
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Marca.Fondo)
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
    ) {
        TextButton(onClick = onVolver) { Text("‹ Volver", color = Marca.TintaSuave) }
        Text("Pago", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Marca.Tinta)
        Text(eventTitle, color = Marca.TintaSuave, fontSize = 14.sp)
        Text(seatSummary, color = Marca.Tinta, fontSize = 14.sp)
        Spacer(Modifier.height(8.dp))
        Surface(shape = RoundedCornerShape(12.dp), color = Marca.Carbon, modifier = Modifier.fillMaxWidth()) {
            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Total", color = Marca.TintaSuave, fontSize = 12.sp)
                    Text(mxn.format(estimatedTotal), fontWeight = FontWeight.Bold, color = Marca.Tinta, fontSize = 20.sp)
                    Text("Incluye cargos e IVA", color = Marca.TintaSuave, fontSize = 11.sp)
                }
                if (!expiresAt.isNullOrBlank()) {
                    Text(
                        if (expired) "Venció" else formatMmSs(remain),
                        color = if (expired || remain < 120) Marca.Peligro else Marca.Dorado,
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp,
                    )
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Nombre") }, modifier = Modifier.fillMaxWidth(), colors = btFieldColors(), singleLine = true)
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = email, onValueChange = { email = it }, label = { Text("Correo") }, modifier = Modifier.fillMaxWidth(), colors = btFieldColors(), singleLine = true)
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = phone, onValueChange = { phone = it }, label = { Text("Teléfono (opcional)") }, modifier = Modifier.fillMaxWidth(), colors = btFieldColors(), singleLine = true)

        Spacer(Modifier.height(16.dp))
        Text("Método", fontWeight = FontWeight.SemiBold, color = Marca.Tinta)
        Spacer(Modifier.height(8.dp))
        methods.forEach { m ->
            val label = when (m) {
                "CARD" -> "Tarjeta · se abre el banco"
                "SPEI" -> "Transferencia SPEI"
                "OXXO" -> "Efectivo en OXXO"
                else -> m
            }
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = if (method == m) Marca.Dorado.copy(alpha = 0.18f) else Marca.Carbon,
                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp).clickable { method = m },
            ) {
                Text(label, Modifier.padding(14.dp), color = Marca.Tinta)
            }
        }

        if (showMsi) {
            Spacer(Modifier.height(12.dp))
            Text("Meses sin intereses", fontWeight = FontWeight.SemiBold, color = Marca.Tinta)
            Text("Si el banco no los ofrece en este comercio, se cobra de contado.", fontSize = 12.sp, color = Marca.TintaSuave)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                msiPlans.forEach { plan ->
                    val active = installments == plan
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = if (active) Marca.Dorado else Marca.Carbon,
                        modifier = Modifier.weight(1f).clickable { installments = plan },
                    ) {
                        Text(
                            if (plan == 1) "1" else "$plan",
                            Modifier.padding(vertical = 10.dp).fillMaxWidth(),
                            color = if (active) Marca.Negro else Marca.Tinta,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }

        config?.takeIf { it.demo }?.let {
            Spacer(Modifier.height(8.dp))
            Text("Modo demostración: no se hace ningún cargo real.", color = Marca.Aviso, fontSize = 12.sp)
        }

        error?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, color = Marca.Peligro, fontSize = 13.sp)
        }

        lastOrder?.paymentAction?.let { action ->
            if (!action.redirectUrl.isNullOrBlank()) {
                Spacer(Modifier.height(12.dp))
                Text("Te abrimos el banco. Cuando termines, tus boletos aparecen en Mis boletos.", color = Marca.TintaSuave, fontSize = 13.sp)
                TextButton(onClick = { openCustomTab(ctx, action.redirectUrl) }) {
                    Text("Abrir de nuevo el banco", color = Marca.Dorado)
                }
            }
            if (!action.reference.isNullOrBlank() || !action.clabe.isNullOrBlank()) {
                Spacer(Modifier.height(12.dp))
                Surface(shape = RoundedCornerShape(12.dp), color = Marca.Carbon, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp)) {
                        Text("Referencia de pago", fontWeight = FontWeight.SemiBold, color = Marca.Tinta)
                        action.reference?.let {
                            Text(it, color = Marca.Dorado, fontSize = 16.sp)
                            TextButton(onClick = { copiar(ctx, it) }) { Text("Copiar referencia", color = Marca.DoradoSuave) }
                        }
                        action.clabe?.let {
                            Text("CLABE: $it", color = Marca.Tinta, fontSize = 14.sp)
                            TextButton(onClick = { copiar(ctx, it) }) { Text("Copiar CLABE", color = Marca.DoradoSuave) }
                        }
                        action.concept?.let { Text("Concepto: $it", color = Marca.TintaSuave, fontSize = 12.sp) }
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = onIrBoletos) { Text("Ir a mis boletos", color = Marca.Dorado) }
        }

        Spacer(Modifier.height(16.dp))
        Button(
            onClick = {
                if (locked || busy || expired) return@Button
                locked = true
                onPagar(
                    name,
                    email,
                    phone,
                    method,
                    if (showMsi && installments > 1) installments else null,
                )
                locked = false
            },
            enabled = !busy && !expired && name.isNotBlank() && email.contains("@"),
            modifier = Modifier.fillMaxWidth().height(52.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Marca.Dorado, contentColor = Marca.Negro),
        ) {
            Text(
                when {
                    busy -> "Procesando…"
                    expired -> "El apartado venció"
                    method == "CARD" -> "Pagar ${mxn.format(estimatedTotal)}"
                    else -> "Generar referencia"
                },
                fontWeight = FontWeight.Bold,
            )
        }
        Spacer(Modifier.height(40.dp))
    }
}

private fun secondsUntil(iso: String?): Int {
    if (iso.isNullOrBlank()) return Int.MAX_VALUE
    val end = runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull() ?: return Int.MAX_VALUE
    return ((end - System.currentTimeMillis()) / 1000).toInt().coerceAtLeast(0)
}

private fun formatMmSs(sec: Int): String {
    val m = sec / 60
    val s = sec % 60
    return "%d:%02d".format(m, s)
}

fun openCustomTab(context: Context, url: String) {
    runCatching {
        CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(url))
    }.onFailure {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    }
}

fun copiar(context: Context, text: String) {
    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    cm.setPrimaryClip(ClipData.newPlainText("boletera", text))
}
