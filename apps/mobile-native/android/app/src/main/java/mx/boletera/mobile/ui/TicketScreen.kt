package mx.boletera.mobile.ui

import android.view.WindowManager
import androidx.activity.compose.LocalActivity
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import mx.boletera.mobile.crypto.RotatingTicketCode
import mx.boletera.mobile.data.WalletEvent
import mx.boletera.mobile.data.WalletTicket

@Composable
fun TicketScreen(
    evento: WalletEvent,
    boleto: WalletTicket,
    sincronizada: Boolean,
    titularFallback: String?,
    pdfBusy: Boolean = false,
    resendBusy: Boolean = false,
    aviso: String? = null,
    error: String? = null,
    onVolver: () -> Unit,
    onDescargarPdf: (() -> Unit)? = null,
    onReenviar: (() -> Unit)? = null,
) {
    val activity = LocalActivity.current

    DisposableEffect(Unit) {
        val ventana = activity?.window
        val anterior = ventana?.attributes?.screenBrightness
        ventana?.attributes = ventana?.attributes?.apply {
            screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_FULL
        }
        onDispose {
            ventana?.attributes = ventana?.attributes?.apply {
                screenBrightness = anterior ?: WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
            }
        }
    }

    var ahora by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(200)
            ahora = System.currentTimeMillis()
        }
    }

    val payload = remember(boleto.id, RotatingTicketCode.windowAt(ahora)) {
        RotatingTicketCode.payload(boleto.signingKey, boleto.id, evento.id, ahora)
    }
    val bitmap = remember(payload) { QrRenderer.generar(payload, 512) }
    val restanteMs = RotatingTicketCode.millisUntilNextWindow(ahora)
    val progreso by animateFloatAsState(
        targetValue = restanteMs / (RotatingTicketCode.ROTATION_SECONDS * 1000f),
        label = "cuenta-atras",
    )
    val titular = boleto.holderName?.takeIf { it.isNotBlank() } ?: titularFallback

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Marca.Fondo)
            .padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onVolver) { Text("‹ Mis boletos", color = Marca.TintaSuave) }
        }
        Spacer(Modifier.height(8.dp))
        Text(evento.title, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Marca.Tinta, textAlign = TextAlign.Center)
        evento.venue?.let {
            Text(it, fontSize = 14.sp, color = Marca.TintaSuave, textAlign = TextAlign.Center)
        }
        Spacer(Modifier.height(20.dp))

        if (!boleto.esUtilizable) {
            EstadoNoUtilizable(boleto.status)
        } else {
            Surface(shape = RoundedCornerShape(20.dp), color = Marca.Carbon) {
                Column(Modifier.padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Image(
                        bitmap = bitmap.asImageBitmap(),
                        contentDescription =
                            "Código de acceso del boleto ${boleto.code}. Cambia cada " +
                                "${RotatingTicketCode.ROTATION_SECONDS} segundos.",
                        modifier = Modifier.size(260.dp).clip(RoundedCornerShape(8.dp)),
                    )
                    Spacer(Modifier.height(14.dp))
                    LinearProgressIndicator(
                        progress = { progreso },
                        modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)),
                        color = Marca.Dorado,
                        trackColor = Marca.Borde,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Se renueva en ${(restanteMs / 1000) + 1} s",
                        fontSize = 12.sp,
                        color = Marca.TintaSuave,
                    )
                }
            }
        }

        Spacer(Modifier.height(18.dp))
        titular?.let {
            Text("Titular", fontSize = 12.sp, color = Marca.TintaSuave)
            Text(it, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Marca.Tinta)
            Spacer(Modifier.height(8.dp))
        }
        Text(boleto.ubicacion, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Marca.Tinta)
        boleto.gate?.let {
            Text("Puerta $it", fontSize = 14.sp, color = Marca.DoradoSuave)
        } ?: Text(
            "Puerta según el recinto",
            fontSize = 13.sp,
            color = Marca.TintaSuave,
        )
        boleto.ticketType?.let {
            Text(it, fontSize = 13.sp, color = Marca.TintaSuave)
        }
        Text(boleto.code, fontSize = 13.sp, fontFamily = FontFamily.Monospace, color = Marca.TintaSuave)

        
        Spacer(Modifier.height(12.dp))
        aviso?.let { Text(it, color = Marca.Exito, fontSize = 13.sp, textAlign = TextAlign.Center) }
        error?.let { Text(it, color = Marca.Peligro, fontSize = 13.sp, textAlign = TextAlign.Center) }
        if (onDescargarPdf != null || onReenviar != null) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (onDescargarPdf != null) {
                    OutlinedButton(
                        onClick = onDescargarPdf,
                        enabled = !pdfBusy,
                        modifier = Modifier.weight(1f).height(48.dp),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Marca.Tinta),
                    ) {
                        Text(if (pdfBusy) "Descargando…" else "Descargar PDF")
                    }
                }
                if (onReenviar != null) {
                    Button(
                        onClick = onReenviar,
                        enabled = !resendBusy,
                        modifier = Modifier.weight(1f).height(48.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Marca.Dorado, contentColor = Marca.Negro),
                    ) {
                        Text(if (resendBusy) "Enviando…" else "Reenviar")
                    }
                }
            }
        }
        Spacer(Modifier.weight(1f))
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = Marca.Carbon,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(14.dp)) {
                Text(
                    if (sincronizada) "Funciona sin internet" else "Sin conexión · copia guardada",
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 14.sp,
                    color = if (sincronizada) Marca.Exito else Marca.Aviso,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "El código se genera en este teléfono. Una captura no sirve: caduca en " +
                        "${RotatingTicketCode.ROTATION_SECONDS} segundos.",
                    fontSize = 12.sp,
                    color = Marca.TintaSuave,
                )
            }
        }
    }
}

@Composable
private fun EstadoNoUtilizable(status: String) {
    val (titulo, detalle) = when (status.uppercase()) {
        "USED" -> "Ya se usó" to "Este boleto se escaneó en la puerta."
        "REFUNDED" -> "Reembolsado" to "Se devolvió el importe; ya no da acceso."
        "CANCELLED" -> "Cancelado" to "Este boleto quedó cancelado."
        "TRANSFERRED" -> "Transferido" to "El código lo tiene ahora otra cuenta."
        else -> "No disponible" to "Este boleto no está activo ($status)."
    }
    Surface(shape = RoundedCornerShape(16.dp), color = Marca.Carbon, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(titulo, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Marca.Tinta)
            Spacer(Modifier.height(6.dp))
            Text(detalle, fontSize = 14.sp, color = Marca.TintaSuave, textAlign = TextAlign.Center)
        }
    }
}
