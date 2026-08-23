package mx.boletera.mobile.ui

import android.graphics.Bitmap
import androidx.compose.ui.graphics.Color
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

/**
 * Dibuja el QR en el propio teléfono.
 *
 * Pedirle la imagen al servidor sería más simple, pero ataría el acceso a tener
 * cobertura en la puerta — que es justo donde no la hay. Aquí se genera en
 * local, así que el boleto funciona en modo avión.
 */
object QrRenderer {

    /**
     * Corrección de errores BAJA a propósito.
     *
     * Más corrección significa más módulos para el mismo dato, y más módulos en
     * la misma pantalla significa cada cuadrito más pequeño. En una puerta el
     * enemigo no es el daño del código —la pantalla no se raya en 15 segundos—
     * sino el brillo bajo, el dedo encima y el lector a 30 cm. Menos módulos y
     * más grandes se leen antes.
     */
    private val NIVEL_CORRECCION = ErrorCorrectionLevel.L

    fun generar(payload: String, ladoPx: Int): Bitmap {
        val hints = mapOf(
            EncodeHintType.ERROR_CORRECTION to NIVEL_CORRECCION,
            EncodeHintType.CHARACTER_SET to "UTF-8",
            // Sin margen propio: el espacio en blanco lo pone el contenedor, que
            // sabe cuánto sitio hay. Un margen doble encoge el código inútilmente.
            EncodeHintType.MARGIN to 0,
        )
        val matriz = QRCodeWriter().encode(payload, BarcodeFormat.QR_CODE, ladoPx, ladoPx, hints)

        val ancho = matriz.width
        val alto = matriz.height
        val pixeles = IntArray(ancho * alto)
        val negro = android.graphics.Color.BLACK
        val blanco = android.graphics.Color.WHITE
        for (y in 0 until alto) {
            val fila = y * ancho
            for (x in 0 until ancho) {
                pixeles[fila + x] = if (matriz[x, y]) negro else blanco
            }
        }
        return Bitmap.createBitmap(ancho, alto, Bitmap.Config.ARGB_8888).apply {
            setPixels(pixeles, 0, ancho, 0, 0, ancho, alto)
        }
    }
}

/** Paleta de la app, alineada con la rampa del sistema de diseño web. */
object Marca {
    val Acento = Color(0xFFE11D48)
    val AcentoOscuro = Color(0xFFBE123C)
    val Tinta = Color(0xFF14171D)
    val TintaSuave = Color(0xFF545C6B)
    val Papel = Color(0xFFFFFFFF)
    val Fondo = Color(0xFFF8F9FB)
    val Borde = Color(0xFFE0E3EA)
    val Exito = Color(0xFF16A34A)
    val Aviso = Color(0xFFA16207)
}
