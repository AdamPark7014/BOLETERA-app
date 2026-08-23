package mx.boletera.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import mx.boletera.mobile.data.Wallet
import mx.boletera.mobile.data.WalletException
import mx.boletera.mobile.data.WalletRepository
import mx.boletera.mobile.data.WalletTicket
import mx.boletera.mobile.ui.EstadoCartera
import mx.boletera.mobile.ui.TicketScreen
import mx.boletera.mobile.ui.WalletScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface { BoleteraApp() }
            }
        }
    }
}

@Composable
private fun BoleteraApp() {
    val vm: WalletViewModel = viewModel(factory = WalletViewModel.Factory(LocalContextApp()))
    val estado by vm.estado.collectAsState()
    var abierto by remember { mutableStateOf<Pair<Wallet, WalletTicket>?>(null) }

    // Al volver del boleto se refresca: el estado puede haber cambiado (se usó
    // en la puerta, se transfirió) y enseñar un boleto muerto como válido es
    // peor que tardar un segundo.
    LaunchedEffect(Unit) { vm.cargarTodo() }

    val seleccion = abierto
    if (seleccion != null) {
        TicketScreen(
            evento = seleccion.first.event,
            boleto = seleccion.second,
            sincronizada = estado.sincronizada,
            onVolver = {
                abierto = null
                vm.cargarTodo()
            },
        )
    } else {
        WalletScreen(
            estado = estado,
            onAgregarOrden = vm::agregar,
            onAbrirBoleto = { cartera, boleto -> abierto = cartera to boleto },
            onRefrescar = vm::cargarTodo,
            onOlvidar = vm::olvidar,
        )
    }
}

@Composable
private fun LocalContextApp() = androidx.compose.ui.platform.LocalContext.current.applicationContext

class WalletViewModel(context: android.content.Context) : ViewModel() {

    private val repo = WalletRepository(context)
    private val _estado = kotlinx.coroutines.flow.MutableStateFlow(EstadoCartera())
    val estado: kotlinx.coroutines.flow.StateFlow<EstadoCartera> = _estado

    fun agregar(publicId: String) {
        val limpio = publicId.trim().uppercase()
        viewModelScope.launch {
            _estado.value = _estado.value.copy(cargando = true, error = null)
            try {
                // Al AÑADIR sí hace falta red: no hay copia local que enseñar y
                // fallar en silencio dejaría al comprador con una lista vacía
                // sin saber por qué.
                val cartera = repo.descargar(limpio, accessToken = null)
                repo.guardar(cartera)
                cargarTodo()
            } catch (e: Exception) {
                _estado.value = _estado.value.copy(
                    cargando = false,
                    error = (e as? WalletException)?.message
                        ?: "No se pudo añadir la orden. Revisa el código y tu conexión.",
                )
            }
        }
    }

    fun cargarTodo() {
        viewModelScope.launch {
            val ids = repo.ordenesGuardadas()
            if (ids.isEmpty()) {
                _estado.value = EstadoCartera()
                return@launch
            }
            _estado.value = _estado.value.copy(cargando = true, error = null)

            val carteras = mutableListOf<Wallet>()
            var todasSincronizadas = true
            for (id in ids) {
                try {
                    val r = repo.cargar(id, accessToken = null)
                    carteras += r.wallet
                    if (!r.sincronizada) todasSincronizadas = false
                } catch (_: Exception) {
                    // Una orden que no se puede leer NI local NI remota no debe
                    // tumbar la lista entera: el resto de boletos siguen valiendo.
                    todasSincronizadas = false
                }
            }
            _estado.value = EstadoCartera(
                carteras = carteras,
                cargando = false,
                sincronizada = todasSincronizadas,
                aviso = if (todasSincronizadas) null
                        else "Sin conexión · se muestran tus copias guardadas",
            )
        }
    }

    fun olvidar(publicId: String) {
        repo.olvidar(publicId)
        cargarTodo()
    }

    class Factory(private val context: android.content.Context) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            WalletViewModel(context) as T
    }
}
