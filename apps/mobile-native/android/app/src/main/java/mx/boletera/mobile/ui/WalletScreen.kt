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

/**
 * Lista de boletos de una orden.
 *
 * La app NO exige crear cuenta: se entra con el código de orden que ya viene en
 * el correo de compra. Obligar a registrarse para enseñar un boleto que ya está
 * pagado es fricción que solo produce llamadas a soporte el día del evento.
 */
@Composable
fun WalletScreen(
    estado: EstadoCartera,
    onAgregarOrden: (String) -> Unit,
    onAbrirBoleto: (Wallet, WalletTicket) -> Unit,
    onRefrescar: () -> Unit,
    onOlvidar: (String) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Marca.Fondo)
            .padding(horizontal = 20.dp),
    ) {
        Spacer(Modifier.height(28.dp))
        Text("Mis boletos", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Marca.Tinta)
        Spacer(Modifier.height(16.dp))

        AgregarOrden(cargando = estado.cargando, onAgregar = onAgregarOrden)

        estado.error?.let {
            Spacer(Modifier.height(12.dp))
            Surface(shape = RoundedCornerShape(10.dp), color = Color_DangerWash) {
                Text(
                    it,
                    modifier = Modifier.padding(12.dp).fillMaxWidth(),
                    color = Marca.AcentoOscuro,
                    fontSize = 13.sp,
                )
            }
        }

        estado.aviso?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, fontSize = 12.sp, color = Marca.Aviso)
        }

        Spacer(Modifier.height(16.dp))

        if (estado.carteras.isEmpty() && !estado.cargando) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(top = 48.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("Todavía no hay boletos aquí", fontWeight = FontWeight.SemiBold, color = Marca.Tinta)
                Spacer(Modifier.height(6.dp))
                Text(
                    "Añade el código de orden que te llegó por correo. " +
                        "Una vez añadido, el boleto funciona sin internet.",
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
                    onAbrirBoleto = { boleto -> onAbrirBoleto(cartera, boleto) },
                    onOlvidar = { onOlvidar(cartera.publicId) },
                )
            }
            item {
                Spacer(Modifier.height(12.dp))
                TextButton(onClick = onRefrescar, modifier = Modifier.fillMaxWidth()) {
                    Text("Actualizar", color = Marca.TintaSuave)
                }
                Spacer(Modifier.height(24.dp))
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
            // El código va en mayúsculas y sin autocorrector: el teclado no debe
            // "arreglar" un identificador.
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Characters,
                autoCorrectEnabled = false,
                imeAction = ImeAction.Done,
            ),
        )
        Spacer(Modifier.width(10.dp))
        Button(
            onClick = { if (texto.isNotBlank()) { onAgregar(texto); texto = "" } },
            enabled = texto.isNotBlank() && !cargando,
            colors = ButtonDefaults.buttonColors(containerColor = Marca.Acento),
        ) {
            if (cargando) {
                CircularProgressIndicator(
                    modifier = Modifier.size(18.dp),
                    strokeWidth = 2.dp,
                    color = Marca.Papel,
                )
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
) {
    Surface(shape = RoundedCornerShape(16.dp), color = Marca.Papel, shadowElevation = 1.dp) {
        Column(Modifier.padding(16.dp)) {
            Text(cartera.event.title, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = Marca.Tinta)
            cartera.event.venue?.let {
                Text(it, fontSize = 13.sp, color = Marca.TintaSuave)
            }
            Text(
                cartera.publicId,
                fontSize = 11.sp,
                fontFamily = FontFamily.Monospace,
                color = Marca.TintaSuave,
            )

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
                        Text(
                            boleto.code,
                            fontSize = 11.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Marca.TintaSuave,
                        )
                    }
                    // El estado se dice con palabra, no solo con color: un
                    // daltónico no debe tener que adivinar si su boleto sirve.
                    if (boleto.esUtilizable) {
                        Text("Ver código", color = Marca.Acento, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                    } else {
                        Text(etiquetaEstado(boleto.status), color = Marca.TintaSuave, fontSize = 13.sp)
                    }
                }
                HorizontalDivider(color = Marca.Borde)
            }

            Spacer(Modifier.height(6.dp))
            TextButton(onClick = onOlvidar) {
                Text("Quitar de este teléfono", fontSize = 12.sp, color = Marca.TintaSuave)
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

private val Color_DangerWash = androidx.compose.ui.graphics.Color(0xFFFEF2F2)

data class EstadoCartera(
    val carteras: List<Wallet> = emptyList(),
    val cargando: Boolean = false,
    val error: String? = null,
    val aviso: String? = null,
    val sincronizada: Boolean = true,
)
