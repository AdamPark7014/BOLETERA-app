package mx.boletera.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mx.boletera.mobile.data.Wallet
import mx.boletera.mobile.data.WalletTicket

@Composable
fun WalletScreen(
    estado: EstadoCartera,
    onAgregarOrden: (String) -> Unit,
    onAbrirBoleto: (Wallet, WalletTicket) -> Unit,
    onRefrescar: () -> Unit,
    onOlvidar: (String) -> Unit,
    onTransferir: (WalletTicket) -> Unit,
    onReenviar: (Wallet) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Marca.Fondo)
            .padding(horizontal = 20.dp),
    ) {
        Spacer(Modifier.height(20.dp))
        Text("Mis boletos", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Marca.Tinta)
        Text(
            "Próximos primero · el QR funciona sin señal",
            fontSize = 13.sp,
            color = Marca.TintaSuave,
        )
        Spacer(Modifier.height(16.dp))

        AgregarOrden(cargando = estado.cargando, onAgregar = onAgregarOrden)

        estado.error?.let {
            Spacer(Modifier.height(12.dp))
            Surface(shape = RoundedCornerShape(10.dp), color = Marca.Carbon) {
                Text(it, modifier = Modifier.padding(12.dp).fillMaxWidth(), color = Marca.Peligro, fontSize = 13.sp)
            }
        }
        estado.aviso?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, fontSize = 12.sp, color = Marca.Aviso)
        }

        Spacer(Modifier.height(16.dp))

        if (estado.carteras.isEmpty() && !estado.cargando) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(top = 40.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("Todavía no hay boletos aquí", fontWeight = FontWeight.SemiBold, color = Marca.Tinta)
                Spacer(Modifier.height(6.dp))
                Text(
                    "Entra con tu cuenta o añade el código de orden del correo. " +
                        "Una vez en el teléfono, el boleto abre la puerta sin internet.",
                    fontSize = 13.sp,
                    color = Marca.TintaSuave,
                    textAlign = TextAlign.Center,
                )
            }
        }

        LazyColumn(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            items(estado.carteras, key = { it.publicId }) { cartera ->
                TarjetaEvento(
                    cartera = cartera,
                    onAbrirBoleto = { onAbrirBoleto(cartera, it) },
                    onOlvidar = { onOlvidar(cartera.publicId) },
                    onTransferir = onTransferir,
                    onReenviar = { onReenviar(cartera) },
                )
            }
            item {
                Spacer(Modifier.height(8.dp))
                TextButton(onClick = onRefrescar, modifier = Modifier.fillMaxWidth()) {
                    Text("Actualizar", color = Marca.TintaSuave)
                }
                Spacer(Modifier.height(88.dp))
            }
        }
    }
}

@Composable
private fun AgregarOrden(cargando: Boolean, onAgregar: (String) -> Unit) {
    var texto by remember { mutableStateOf("") }
    Row(verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
            value = texto,
            onValueChange = { texto = it.trim() },
            label = { Text("Código de orden") },
            placeholder = { Text("BLT-XXXXXX") },
            singleLine = true,
            modifier = Modifier.weight(1f),
            colors = btFieldColors(),
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Characters,
                autoCorrectEnabled = false,
                imeAction = ImeAction.Done,
            ),
        )
        Spacer(Modifier.width(10.dp))
        Button(
            onClick = {
                if (texto.isNotBlank() && !cargando) {
                    onAgregar(texto)
                    texto = ""
                }
            },
            enabled = texto.isNotBlank() && !cargando,
            colors = ButtonDefaults.buttonColors(containerColor = Marca.Dorado, contentColor = Marca.Negro),
        ) {
            if (cargando) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Marca.Negro)
            } else {
                Text("Añadir")
            }
        }
    }
}

@Composable
private fun TarjetaEvento(
    cartera: Wallet,
    onAbrirBoleto: (WalletTicket) -> Unit,
    onOlvidar: () -> Unit,
    onTransferir: (WalletTicket) -> Unit,
    onReenviar: () -> Unit,
) {
    Surface(shape = RoundedCornerShape(16.dp), color = Marca.Carbon) {
        Column(Modifier.padding(16.dp)) {
            Text(cartera.event.title, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = Marca.Tinta)
            cartera.event.venue?.let { Text(it, fontSize = 13.sp, color = Marca.TintaSuave) }
            if (!cartera.publicId.startsWith("mine:")) {
                Text(cartera.publicId, fontSize = 11.sp, fontFamily = FontFamily.Monospace, color = Marca.TintaSuave)
            }
            Spacer(Modifier.height(12.dp))
            cartera.tickets.forEach { boleto ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onAbrirBoleto(boleto) }
                        .padding(vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(boleto.ubicacion, fontSize = 15.sp, color = Marca.Tinta)
                        boleto.gate?.let { Text("Puerta $it", fontSize = 12.sp, color = Marca.TintaSuave) }
                        Text(boleto.code, fontSize = 11.sp, fontFamily = FontFamily.Monospace, color = Marca.TintaSuave)
                    }
                    if (boleto.esUtilizable) {
                        Text("Ver código", color = Marca.Dorado, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                    } else {
                        Text(etiquetaEstado(boleto.status), color = Marca.TintaSuave, fontSize = 13.sp)
                    }
                }
                if (boleto.esUtilizable) {
                    TextButton(onClick = { onTransferir(boleto) }) {
                        Text("Transferir", fontSize = 12.sp, color = Marca.TintaSuave)
                    }
                }
                HorizontalDivider(color = Marca.Borde)
            }
            Row {
                TextButton(onClick = onReenviar) {
                    Text("Reenviar boletos", fontSize = 12.sp, color = Marca.DoradoSuave)
                }
                if (!cartera.publicId.startsWith("mine:")) {
                    TextButton(onClick = onOlvidar) {
                        Text("Quitar de este teléfono", fontSize = 12.sp, color = Marca.TintaSuave)
                    }
                }
            }
        }
    }
}

private fun etiquetaEstado(status: String) = when (status.uppercase()) {
    "USED" -> "Ya usado"
    "REFUNDED" -> "Reembolsado"
    "CANCELLED" -> "Cancelado"
    "TRANSFERRED" -> "Transferido"
    else -> status.lowercase().replaceFirstChar { it.uppercase() }
}

@Composable
fun btFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = Marca.Tinta,
    unfocusedTextColor = Marca.Tinta,
    focusedBorderColor = Marca.Dorado,
    unfocusedBorderColor = Marca.Borde,
    focusedLabelColor = Marca.DoradoSuave,
    unfocusedLabelColor = Marca.TintaSuave,
    cursorColor = Marca.Dorado,
)

data class EstadoCartera(
    val carteras: List<Wallet> = emptyList(),
    val cargando: Boolean = false,
    val error: String? = null,
    val aviso: String? = null,
    val sincronizada: Boolean = true,
)
