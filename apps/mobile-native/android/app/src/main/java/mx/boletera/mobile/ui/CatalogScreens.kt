package mx.boletera.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mx.boletera.mobile.data.ApiException
import mx.boletera.mobile.data.CatalogEvent
import mx.boletera.mobile.data.HoldResult
import mx.boletera.mobile.data.OfferCard
import java.text.NumberFormat
import java.util.Locale

private val mxn = NumberFormat.getCurrencyInstance(Locale("es", "MX"))

@Composable
fun CatalogScreen(
    events: List<CatalogEvent>,
    cargando: Boolean,
    error: String?,
    query: String,
    onQuery: (String) -> Unit,
    onBuscar: () -> Unit,
    onAbrir: (CatalogEvent) -> Unit,
) {
    Column(
        Modifier.fillMaxSize().background(Marca.Fondo).padding(horizontal = 20.dp),
    ) {
        Spacer(Modifier.height(20.dp))
        Text("Cartelera", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Marca.Tinta)
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = query,
                onValueChange = onQuery,
                modifier = Modifier.weight(1f),
                singleLine = true,
                label = { Text("Buscar") },
                colors = btFieldColors(),
            )
            Spacer(Modifier.width(8.dp))
            Button(
                onClick = onBuscar,
                colors = ButtonDefaults.buttonColors(containerColor = Marca.Dorado, contentColor = Marca.Negro),
            ) { Text("Ir") }
        }
        error?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, color = Marca.Peligro, fontSize = 13.sp)
        }
        if (cargando) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Marca.Dorado)
            }
        } else {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = PaddingValues(top = 16.dp, bottom = 88.dp),
            ) {
                items(events, key = { it.id }) { e ->
                    Surface(
                        shape = RoundedCornerShape(16.dp),
                        color = Marca.Carbon,
                        modifier = Modifier.fillMaxWidth().clickable { onAbrir(e) },
                    ) {
                        Column(Modifier.padding(16.dp)) {
                            Text(e.title, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = Marca.Tinta)
                            listOfNotNull(e.venueName, e.city).joinToString(" · ").takeIf { it.isNotBlank() }?.let {
                                Text(it, fontSize = 13.sp, color = Marca.TintaSuave)
                            }
                            e.startsAt?.let { Text(it.take(16).replace('T', ' '), fontSize = 12.sp, color = Marca.TintaSuave) }
                            Spacer(Modifier.height(8.dp))
                            Text(
                                if (e.minPriceAllIn > 0) "Desde ${mxn.format(e.minPriceAllIn)}" else "Ver zonas",
                                color = Marca.Dorado,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 14.sp,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun EventDetailScreen(
    event: CatalogEvent,
    cargando: Boolean,
    error: String?,
    onVolver: () -> Unit,
    onApartar: (offer: OfferCard, qty: Int, accessCode: String, best: Boolean) -> Unit,
    onEspera: (OfferCard) -> Unit,
) {
    var selected by remember { mutableStateOf<OfferCard?>(event.offers.firstOrNull { !it.agotada }) }
    var qty by remember { mutableIntStateOf(1) }
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var localError by remember { mutableStateOf<String?>(null) }

    val offer = selected
    val agotado = event.offers.isEmpty() || event.offers.all { it.agotada }

    Column(Modifier.fillMaxSize().background(Marca.Fondo).padding(20.dp)) {
        TextButton(onClick = onVolver) { Text("‹ Cartelera", color = Marca.TintaSuave) }
        Spacer(Modifier.height(8.dp))
        Text(event.title, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Marca.Tinta)
        listOfNotNull(event.venueName, event.city).joinToString(" · ").takeIf { it.isNotBlank() }?.let {
            Text(it, color = Marca.TintaSuave, fontSize = 14.sp)
        }
        Spacer(Modifier.height(16.dp))

        if (agotado) {
            Surface(shape = RoundedCornerShape(14.dp), color = Marca.Carbon, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Agotado", fontWeight = FontWeight.Bold, color = Marca.Tinta)
                    Text("Únete a la lista de espera y te avisamos si se libera un boleto.", color = Marca.TintaSuave, fontSize = 13.sp)
                    Spacer(Modifier.height(10.dp))
                    Button(
                        onClick = { event.offers.firstOrNull()?.let(onEspera) ?: onEspera(
                            OfferCard("", "General", null, 0.0, 0.0, 0, false),
                        ) },
                        colors = ButtonDefaults.buttonColors(containerColor = Marca.Dorado, contentColor = Marca.Negro),
                    ) { Text("Lista de espera") }
                }
            }
        } else {
            Text("Zonas", fontWeight = FontWeight.SemiBold, color = Marca.Tinta)
            Spacer(Modifier.height(8.dp))
            LazyColumn(
                modifier = Modifier.weight(1f, fill = false).heightIn(max = 280.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(event.offers, key = { it.id }) { o ->
                    val active = selected?.id == o.id
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = if (active) Marca.Dorado.copy(alpha = 0.15f) else Marca.Carbon,
                        modifier = Modifier.fillMaxWidth().clickable(enabled = !o.agotada) { selected = o },
                    ) {
                        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(o.name, fontWeight = FontWeight.SemiBold, color = Marca.Tinta)
                                o.zone?.let { Text(it, fontSize = 12.sp, color = Marca.TintaSuave) }
                                if (o.agotada) Text("Agotada", fontSize = 12.sp, color = Marca.Peligro)
                            }
                            Text(mxn.format(o.allInPrice), color = Marca.Dorado, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }

            Spacer(Modifier.height(12.dp))
            Text("Cantidad", color = Marca.TintaSuave, fontSize = 13.sp)
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { if (qty > 1) qty-- }) { Text("−", color = Marca.Tinta, fontSize = 20.sp) }
                Text("$qty", color = Marca.Tinta, fontWeight = FontWeight.Bold, modifier = Modifier.width(32.dp))
                IconButton(onClick = { if (qty < 8) qty++ }) { Text("+", color = Marca.Tinta, fontSize = 20.sp) }
            }
            OutlinedTextField(
                value = code,
                onValueChange = { code = it },
                label = { Text("Código de preventa (si aplica)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                colors = btFieldColors(),
            )
            Spacer(Modifier.height(8.dp))
            (localError ?: error)?.let { Text(it, color = Marca.Peligro, fontSize = 13.sp) }
            Spacer(Modifier.height(8.dp))
            Button(
                onClick = {
                    val o = offer ?: return@Button
                    if (busy || cargando) return@Button
                    busy = true
                    localError = null
                    onApartar(o, qty, code, true)
                    busy = false
                },
                enabled = offer != null && !cargando,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Marca.Dorado, contentColor = Marca.Negro),
            ) {
                Text(
                    if (cargando) "Apartando…" else "Mejor lugar disponible",
                    fontWeight = FontWeight.Bold,
                )
            }
            TextButton(
                onClick = {
                    val o = offer ?: return@TextButton
                    if (busy || cargando) return@TextButton
                    onApartar(o, qty, code, false)
                },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Admisión general (misma zona)", color = Marca.TintaSuave) }
        }
    }
}

fun mensajeHoldError(e: Throwable): String {
    val api = e as? ApiException
    return when (api?.reason) {
        "CODE_REQUIRED" -> "Este evento pide un código de preventa."
        "CODE_INVALID" -> "Ese código de preventa no es válido."
        else -> api?.message ?: e.message ?: "No se pudo apartar."
    }
}

fun HoldResult.resumen(): String =
    if (seatLabels.isNotEmpty()) seatLabels.joinToString(", ")
    else "${holdIds.size} lugar(es)"
