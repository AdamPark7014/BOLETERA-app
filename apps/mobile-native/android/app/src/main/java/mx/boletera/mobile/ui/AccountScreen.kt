package mx.boletera.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mx.boletera.mobile.data.WaitlistClaim

@Composable
fun AccountScreen(
    loggedIn: Boolean,
    email: String?,
    name: String?,
    busy: Boolean,
    error: String?,
    aviso: String?,
    onLogin: (email: String, password: String) -> Unit,
    onLogout: () -> Unit,
) {
    var mail by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }

    Column(
        Modifier
            .fillMaxSize()
            .background(Marca.Fondo)
            .padding(20.dp),
    ) {
        Spacer(Modifier.height(12.dp))
        Text("Cuenta", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Marca.Tinta)
        Spacer(Modifier.height(16.dp))

        if (loggedIn) {
            Surface(shape = RoundedCornerShape(14.dp), color = Marca.Carbon, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text(name ?: "Comprador", fontWeight = FontWeight.SemiBold, color = Marca.Tinta, fontSize = 18.sp)
                    Text(email.orEmpty(), color = Marca.TintaSuave, fontSize = 14.sp)
                }
            }
            Spacer(Modifier.height(16.dp))
            Text(
                "Con sesión puedes ver todos tus boletos, reventa, transferir y reenviar.",
                color = Marca.TintaSuave,
                fontSize = 13.sp,
            )
            Spacer(Modifier.height(16.dp))
            OutlinedButton(
                onClick = onLogout,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Marca.Tinta),
            ) { Text("Cerrar sesión") }
        } else {
            Text(
                "Entra para sincronizar tu cartera, comprar en reventa y transferir boletos.",
                color = Marca.TintaSuave,
                fontSize = 14.sp,
            )
            Spacer(Modifier.height(16.dp))
            OutlinedTextField(
                value = mail,
                onValueChange = { mail = it },
                label = { Text("Correo") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                colors = btFieldColors(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = pass,
                onValueChange = { pass = it },
                label = { Text("Contraseña") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(),
                colors = btFieldColors(),
            )
            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = Marca.Peligro, fontSize = 13.sp)
            }
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = { if (!busy) onLogin(mail, pass) },
                enabled = !busy && mail.contains("@") && pass.isNotBlank(),
                modifier = Modifier.fillMaxWidth().height(52.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Marca.Dorado, contentColor = Marca.Negro),
            ) {
                if (busy) CircularProgressIndicator(Modifier.size(18.dp), color = Marca.Negro, strokeWidth = 2.dp)
                else Text("Entrar", fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(12.dp))
            Text(
                "También puedes añadir un código de orden en Mis boletos sin crear cuenta.",
                color = Marca.TintaSuave,
                fontSize = 12.sp,
            )
        }
        aviso?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, color = Marca.Aviso, fontSize = 13.sp)
        }
    }
}

@Composable
fun WaitlistClaimScreen(
    claim: WaitlistClaim?,
    cargando: Boolean,
    error: String?,
    onConvert: () -> Unit,
    onPagar: () -> Unit,
    onVolver: () -> Unit,
) {
    Column(Modifier.fillMaxSize().background(Marca.Fondo).padding(20.dp)) {
        TextButton(onClick = onVolver) { Text("‹ Volver", color = Marca.TintaSuave) }
        Text("Lista de espera", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Marca.Tinta)
        Spacer(Modifier.height(12.dp))
        when {
            cargando -> CircularProgressIndicator(color = Marca.Dorado)
            error != null -> Text(error, color = Marca.Peligro)
            claim == null -> Text("No encontramos ese enlace.", color = Marca.TintaSuave)
            else -> {
                Text(claim.eventTitle ?: "Tu lugar liberado", fontWeight = FontWeight.SemiBold, color = Marca.Tinta, fontSize = 18.sp)
                claim.expiresAt?.let {
                    Text("Válido hasta $it", color = Marca.Aviso, fontSize = 13.sp)
                }
                Text("Estado: ${claim.status ?: "activo"}", color = Marca.TintaSuave, fontSize = 13.sp)
                Spacer(Modifier.height(16.dp))
                if (claim.holdIds.isEmpty()) {
                    Button(
                        onClick = onConvert,
                        colors = ButtonDefaults.buttonColors(containerColor = Marca.Dorado, contentColor = Marca.Negro),
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Apartar al precio original") }
                } else {
                    Text("Apartado listo · ${claim.holdIds.size} boleto(s)", color = Marca.Exito)
                    Spacer(Modifier.height(8.dp))
                    Button(
                        onClick = onPagar,
                        colors = ButtonDefaults.buttonColors(containerColor = Marca.Dorado, contentColor = Marca.Negro),
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Continuar al pago") }
                }
            }
        }
    }
}

@Composable
fun TransferDialog(
    open: Boolean,
    ticketLabel: String,
    busy: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    onConfirm: (email: String, message: String) -> Unit,
) {
    if (!open) return
    var email by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Transferir boleto") },
        text = {
            Column {
                Text(ticketLabel, color = Marca.TintaSuave, fontSize = 13.sp)
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("Correo del destinatario") },
                    singleLine = true,
                    colors = btFieldColors(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = message,
                    onValueChange = { message = it },
                    label = { Text("Mensaje (opcional)") },
                    colors = btFieldColors(),
                )
                error?.let { Text(it, color = Marca.Peligro, fontSize = 12.sp) }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { if (!busy && email.contains("@")) onConfirm(email, message) },
                enabled = !busy,
            ) { Text("Enviar", color = Marca.Dorado) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancelar", color = Marca.TintaSuave) }
        },
        containerColor = Marca.Carbon,
        titleContentColor = Marca.Tinta,
        textContentColor = Marca.Tinta,
    )
}
