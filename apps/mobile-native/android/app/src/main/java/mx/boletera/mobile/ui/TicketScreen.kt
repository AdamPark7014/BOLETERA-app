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

/**
 * El boleto, con su QR vivo.
 *
 * Tres decisiones que solo se entienden habiendo estado en una fila de acceso:
 *
 *  1. **El brillo sube al máximo mientras esta pantalla está delante.** Un lector
 *     de puerta con una pantalla al 20 % y sol de lado no lee. Se restaura al
 *     salir para no vaciar la batería del asistente.
 *  2. **La cuenta atrás es visible.** El código cambia cada 15 s; sin indicador,
 *     quien lo ve cambiar en la mano cree que algo va mal justo cuando le toca
 *     pasar. Verlo rotar es lo que convierte una rareza en una garantía.
 *  3. **Se dice explícitamente que funciona sin conexión.** Es la duda número
 *     uno del comprador con un boleto digital, y la respuesta tiene que estar en
 *     la pantalla, no en un FAQ.
 */
@Composable
fun TicketScreen(
    evento: WalletEvent,
    boleto: WalletTicket,
    sincronizada: Boolean,
    onVolver: () -> Unit,
) {
    val activity = LocalActivity.current

    // Brillo al máximo solo mientras el boleto está en pantalla.
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

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Marca.Fondo)
            .padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onVolver) { Text("‹ Mis boletos", color = Marca.TintaSuave) }
        }

        Spacer(Modifier.height(8.dp))

        Text(
            evento.title,
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
            color = Marca.Tinta,
            textAlign = TextAlign.Center,
        )
        evento.venue?.let {
            Text(it, fontSize = 14.sp, color = Marca.TintaSuave, textAlign = TextAlign.Center)
        }

        Spacer(Modifier.height(20.dp))

        if (!boleto.esUtilizable) {
            EstadoNoUtilizable(boleto.status)
        } else {
            Surface(
                shape = RoundedCornerShape(20.dp),
                color = Marca.Papel,
                shadowElevation = 2.dp,
            ) {
                Column(
                    modifier = Modifier.padding(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Image(
                        bitmap = bitmap.asImageBitmap(),
                        contentDescription =
                            "Código de acceso del boleto ${boleto.code}. Cambia cada " +
                                "${RotatingTicketCode.ROTATION_SECONDS} segundos.",
                        modifier = Modifier
                            .size(260.dp)
                            .clip(RoundedCornerShape(8.dp)),
                    )
                    Spacer(Modifier.height(14.dp))
                    LinearProgressIndicator(
                        progress = { progreso },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(6.dp)
                            .clip(RoundedCornerShape(3.dp)),
                        color = Marca.Acento,
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

        Text(boleto.ubicacion, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Marca.Tinta)
        Text(
            boleto.code,
            fontSize = 13.sp,
            fontFamily = FontFamily.Monospace,
            color = Marca.TintaSuave,
        )

        Spacer(Modifier.weight(1f))

        // La duda número uno del comprador, contestada en la propia pantalla.
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = if (sincronizada) Marca.Papel else Color_AvisoFondo,
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
                    "El código se genera en este teléfono, así que entra igual aunque no " +
                        "haya señal en la puerta. Una captura de pantalla no sirve: caduca " +
                        "en ${RotatingTicketCode.ROTATION_SECONDS} segundos.",
                    fontSize = 12.sp,
                    color = Marca.TintaSuave,
                )
            }
        }
    }
}

private val Color_AvisoFondo = androidx.compose.ui.graphics.Color(0xFFFEFCE8)

@Composable
private fun EstadoNoUtilizable(status: String) {
    val (titulo, detalle) = when (status.uppercase()) {
        "USED" -> "Ya se usó" to "Este boleto se escaneó en la puerta. No se puede volver a usar."
        "REFUNDED" -> "Reembolsado" to "Se devolvió el importe, así que este boleto ya no da acceso."
        "CANCELLED" -> "Cancelado" to "Este boleto quedó cancelado."
        "TRANSFERRED" -> "Transferido" to "Lo enviaste a otra persona; el código lo tiene ahora esa cuenta."
        else -> "No disponible" to "Este boleto no está activo ($status)."
    }
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = Marca.Papel,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(titulo, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Marca.Tinta)
            Spacer(Modifier.height(6.dp))
            Text(detalle, fontSize = 14.sp, color = Marca.TintaSuave, textAlign = TextAlign.Center)
        }
    }
}
