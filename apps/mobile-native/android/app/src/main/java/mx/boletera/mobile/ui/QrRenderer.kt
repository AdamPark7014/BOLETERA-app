package mx.boletera.mobile.ui

import android.graphics.Bitmap
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

/**
 * Dibuja el QR en el propio teléfono.
 * Corrección L: más módulos grandes = mejor lectura a distancia/brillo.
 */
object QrRenderer {

    private val NIVEL_CORRECCION = ErrorCorrectionLevel.L

    fun generar(payload: String, ladoPx: Int): Bitmap {
        val hints = mapOf(
            EncodeHintType.ERROR_CORRECTION to NIVEL_CORRECCION,
            EncodeHintType.CHARACTER_SET to "UTF-8",
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
