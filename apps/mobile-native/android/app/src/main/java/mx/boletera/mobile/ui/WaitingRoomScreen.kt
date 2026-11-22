package mx.boletera.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mx.boletera.mobile.data.QueueStatus

/**
 * Sala de espera: aviso PROFECO + posición. El pase queda atado a la sesión.
 */
@Composable
fun WaitingRoomScreen(
    eventTitle: String,
    status: QueueStatus?,
    cargando: Boolean,
    error: String?,
    onSalir: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Marca.Fondo)
            .padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        TextButton(onClick = onSalir, modifier = Modifier.align(Alignment.Start)) {
            Text("‹ Volver", color = Marca.TintaSuave)
        }
        Spacer(Modifier.height(12.dp))
        Text("Sala de espera", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Marca.Tinta)
        Text(eventTitle, color = Marca.TintaSuave, fontSize = 14.sp, textAlign = TextAlign.Center)
        Spacer(Modifier.height(20.dp))

        Surface(
            shape = RoundedCornerShape(14.dp),
            color = Marca.Carbon,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                "Entrar a la fila no garantiza boleto: el cupo se agota y llegar a tu turno " +
                    "no asegura que queden lugares.",
                Modifier.padding(16.dp),
                color = Marca.Tinta,
                fontSize = 14.sp,
            )
        }

        Spacer(Modifier.height(20.dp))
        error?.let {
            Text(it, color = Marca.Peligro, fontSize = 13.sp, textAlign = TextAlign.Center)
            Spacer(Modifier.height(12.dp))
        }

        when {
            cargando && status == null -> CircularProgressIndicator(color = Marca.Dorado)
            status?.admitted == true -> {
                Text("Es tu turno", fontWeight = FontWeight.Bold, fontSize = 20.sp, color = Marca.Exito)
                Text(
                    "Ya puedes apartar. Tu pase está ligado a esta sesión.",
                    color = Marca.TintaSuave,
                    fontSize = 13.sp,
                    textAlign = TextAlign.Center,
                )
            }
            status != null -> {
                val pos = status.position
                Text(
                    if (pos != null) "Lugar $pos de ${status.total}" else "${status.total} personas en fila",
                    fontWeight = FontWeight.Bold,
                    fontSize = 22.sp,
                    color = Marca.Tinta,
                )
                Text(
                    "Delante: ${status.ahead}",
                    color = Marca.TintaSuave,
                    fontSize = 14.sp,
                )
                if (status.estimatedWaitSeconds > 0) {
                    val min = (status.estimatedWaitSeconds + 59) / 60
                    Text("Espera estimada: ~$min min", color = Marca.DoradoSuave, fontSize = 13.sp)
                }
                Spacer(Modifier.height(12.dp))
                Text(
                    "El orden se sortea al abrir; no depende de quién llegó primero.",
                    color = Marca.TintaSuave,
                    fontSize = 12.sp,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

@Composable
fun HumanChallengeDialog(
    open: Boolean,
    busy: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    if (!open) return
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        containerColor = Marca.Carbon,
        title = { Text("Confirma que eres una persona", color = Marca.Tinta) },
        text = {
            Column {
                Text(
                    "Detectamos actividad inusual. Confirma que eres una persona para seguir.",
                    color = Marca.TintaSuave,
                    fontSize = 14.sp,
                )
                error?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(it, color = Marca.Peligro, fontSize = 13.sp)
                }
            }
        },
        confirmButton = {
            Button(
                onClick = onConfirm,
                enabled = !busy,
                colors = ButtonDefaults.buttonColors(
                    containerColor = Marca.Dorado,
                    contentColor = Marca.Negro,
                ),
            ) {
                Text(if (busy) "Comprobando…" else "Soy una persona")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !busy) {
                Text("Cancelar", color = Marca.TintaSuave)
            }
        },
    )
}
