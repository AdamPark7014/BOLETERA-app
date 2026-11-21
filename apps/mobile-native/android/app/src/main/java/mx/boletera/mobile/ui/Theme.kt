package mx.boletera.mobile.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * Black Ticket en el teléfono: negro, carbón y dorado solo en la acción principal.
 * El rosa antiguo (#E11D48) queda fuera: era de un prototipo, no del sistema de diseño.
 */
object Marca {
    val Negro = Color(0xFF000000)
    val Carbon = Color(0xFF1A1A1A)
    val Dorado = Color(0xFFA68A6B)
    val DoradoSuave = Color(0xFFC4A882)
    val Tinta = Color(0xFFF5F2EB)
    val TintaSuave = Color(0xFFB8B0A4)
    val Papel = Color(0xFF1A1A1A)
    val Fondo = Color(0xFF000000)
    val Borde = Color(0xFF2A2A2A)
    val Exito = Color(0xFF6FCF97)
    val Aviso = Color(0xFFE6C07B)
    val Peligro = Color(0xFFE57373)

    /** Alias para pantallas que aún usan el nombre viejo. */
    val Acento = Dorado
    val AcentoOscuro = DoradoSuave
}

private val BtDark = darkColorScheme(
    primary = Marca.Dorado,
    onPrimary = Marca.Negro,
    secondary = Marca.DoradoSuave,
    background = Marca.Fondo,
    surface = Marca.Carbon,
    onBackground = Marca.Tinta,
    onSurface = Marca.Tinta,
    outline = Marca.Borde,
    error = Marca.Peligro,
)

@Composable
fun BoleteraTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = BtDark, content = content)
}
