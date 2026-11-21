package mx.boletera.mobile

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ConfirmationNumber
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.SwapHoriz
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import androidx.navigation.navDeepLink
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import mx.boletera.mobile.data.*
import mx.boletera.mobile.ui.*
import org.json.JSONArray

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            BoleteraTheme {
                Surface(color = Marca.Fondo) {
                    BoleteraApp(initialIntent = intent)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
    }
}

private sealed class Tab(val route: String, val label: String, val icon: ImageVector) {
    data object Boletos : Tab("boletos", "Boletos", Icons.Outlined.ConfirmationNumber)
    data object Cartelera : Tab("cartelera", "Cartelera", Icons.Outlined.Event)
    data object Reventa : Tab("reventa", "Reventa", Icons.Outlined.SwapHoriz)
    data object Cuenta : Tab("cuenta", "Cuenta", Icons.Outlined.Person)
}

@Composable
private fun BoleteraApp(initialIntent: Intent?) {
    val ctx = LocalContext.current.applicationContext
    val vm: AppViewModel = viewModel(factory = AppViewModel.Factory(ctx))
    val nav = rememberNavController()
    val tabs = listOf(Tab.Boletos, Tab.Cartelera, Tab.Reventa, Tab.Cuenta)
    val backStack by nav.currentBackStackEntryAsState()
    val route = backStack?.destination?.route.orEmpty()
    val showBar = tabs.any { route == it.route || route.startsWith(it.route) }

    LaunchedEffect(Unit) {
        vm.bootstrap()
        deepLinkEspera(initialIntent?.data)?.let { nav.navigate("espera/$it") }
    }

    Scaffold(
        containerColor = Marca.Fondo,
        bottomBar = {
            if (showBar) {
                NavigationBar(containerColor = Marca.Carbon, contentColor = Marca.Tinta) {
                    tabs.forEach { tab ->
                        NavigationBarItem(
                            selected = route == tab.route,
                            onClick = {
                                nav.navigate(tab.route) {
                                    popUpTo(Tab.Boletos.route) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = { Icon(tab.icon, contentDescription = tab.label) },
                            label = { Text(tab.label) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = Marca.Dorado,
                                selectedTextColor = Marca.Dorado,
                                unselectedIconColor = Marca.TintaSuave,
                                unselectedTextColor = Marca.TintaSuave,
                                indicatorColor = Marca.Negro,
                            ),
                        )
                    }
                }
            }
        },
    ) { pad ->
        NavHost(navController = nav, startDestination = Tab.Boletos.route, modifier = Modifier.padding(pad)) {
            composable(Tab.Boletos.route) {
                val estado by vm.cartera.collectAsState()
                var abierto by remember { mutableStateOf<Pair<Wallet, WalletTicket>?>(null) }
                var transfer by remember { mutableStateOf<WalletTicket?>(null) }
                val sel = abierto
                if (sel != null) {
                    TicketScreen(
                        evento = sel.first.event,
                        boleto = sel.second,
                        sincronizada = estado.sincronizada,
                        titularFallback = sel.second.holderName ?: vm.session.userName(),
                        onVolver = {
                            abierto = null
                            vm.cargarCartera()
                        },
                    )
                } else {
                    WalletScreen(
                        estado = estado,
                        onAgregarOrden = vm::agregarOrden,
                        onAbrirBoleto = { w, t -> abierto = w to t },
                        onRefrescar = vm::cargarCartera,
                        onOlvidar = vm::olvidar,
                        onTransferir = { transfer = it },
                        onReenviar = vm::reenviar,
                    )
                }
                TransferDialog(
                    open = transfer != null,
                    ticketLabel = transfer?.ubicacion.orEmpty(),
                    busy = estado.cargando,
                    error = estado.error,
                    onDismiss = { transfer = null },
                    onConfirm = { email, msg ->
                        val t = transfer ?: return@TransferDialog
                        vm.transferir(t.id, email, msg) { transfer = null }
                    },
                )
            }
            composable(Tab.Cartelera.route) {
                val cat by vm.catalogo.collectAsState()
                CatalogScreen(
                    events = cat.events,
                    cargando = cat.cargando,
                    error = cat.error,
                    query = cat.query,
                    onQuery = vm::setQuery,
                    onBuscar = vm::buscarEventos,
                    onAbrir = { nav.navigate("evento/${it.slug}") },
                )
            }
            composable(
                "evento/{slug}",
                arguments = listOf(navArgument("slug") { type = NavType.StringType }),
            ) { entry ->
                val slug = entry.arguments?.getString("slug").orEmpty()
                val det by vm.detalle.collectAsState()
                LaunchedEffect(slug) { vm.cargarEvento(slug) }
                val ev = det.event
                if (ev == null && det.cargando) {
                    CircularProgressIndicator(color = Marca.Dorado)
                } else if (ev != null) {
                    EventDetailScreen(
                        event = ev,
                        cargando = det.cargando,
                        error = det.error,
                        onVolver = { nav.popBackStack() },
                        onApartar = { offer, qty, code, best ->
                            vm.apartar(ev, offer, qty, code, best) {
                                nav.navigate("checkout")
                            }
                        },
                        onEspera = { offer ->
                            vm.unirseEspera(ev.id, offer.id) {
                                nav.navigate(Tab.Cuenta.route)
                            }
                        },
                    )
                } else {
                    TextButton(onClick = { nav.popBackStack() }) {
                        Text(det.error ?: "No encontramos el evento", color = Marca.Peligro)
                    }
                }
            }
            composable("checkout") {
                val chk by vm.checkout.collectAsState()
                CheckoutScreen(
                    eventTitle = chk.eventTitle,
                    seatSummary = chk.seatSummary,
                    estimatedTotal = chk.estimatedTotal,
                    expiresAt = chk.expiresAt,
                    config = chk.config,
                    defaultName = vm.session.userName().orEmpty(),
                    defaultEmail = vm.session.userEmail().orEmpty(),
                    busy = chk.busy,
                    error = chk.error,
                    lastOrder = chk.lastOrder,
                    onPagar = { n, e, p, m, inst -> vm.pagar(n, e, p, m, inst) },
                    onVolver = { nav.popBackStack() },
                    onIrBoletos = {
                        vm.cargarCartera()
                        nav.navigate(Tab.Boletos.route) { launchSingleTop = true }
                    },
                )
            }
            composable(Tab.Reventa.route) {
                val r by vm.reventa.collectAsState()
                val cartera by vm.cartera.collectAsState()
                LaunchedEffect(Unit) { vm.cargarReventa() }
                ResaleScreen(
                    listings = r.listings,
                    sales = r.sales,
                    loggedIn = vm.session.isLoggedIn(),
                    cargando = r.cargando,
                    error = r.error,
                    lastCheckout = r.lastCheckout,
                    sellable = cartera.carteras.flatMap { it.tickets }.filter { it.esUtilizable },
                    onRefresh = vm::cargarReventa,
                    onBuy = { id -> vm.comprarReventa(id) },
                    onSell = { id, price -> vm.venderReventa(id, price) },
                    onLoginHint = { nav.navigate(Tab.Cuenta.route) },
                )
            }
            composable(Tab.Cuenta.route) {
                val acc by vm.cuenta.collectAsState()
                AccountScreen(
                    loggedIn = vm.session.isLoggedIn(),
                    email = vm.session.userEmail(),
                    name = vm.session.userName(),
                    busy = acc.busy,
                    error = acc.error,
                    aviso = acc.aviso,
                    onLogin = { e, p -> vm.login(e, p) },
                    onLogout = vm::logout,
                )
            }
            composable(
                "espera/{token}",
                arguments = listOf(navArgument("token") { type = NavType.StringType }),
                deepLinks = listOf(
                    navDeepLink { uriPattern = "boletera://espera/{token}" },
                    navDeepLink { uriPattern = "https://*.boletera.mx/espera/{token}" },
                    navDeepLink { uriPattern = "http://localhost:3000/espera/{token}" },
                ),
            ) { entry ->
                val token = entry.arguments?.getString("token").orEmpty()
                val w by vm.waitlist.collectAsState()
                LaunchedEffect(token) { vm.abrirEspera(token) }
                WaitlistClaimScreen(
                    claim = w.claim,
                    cargando = w.cargando,
                    error = w.error,
                    onConvert = { vm.convertirEspera(token) },
                    onPagar = {
                        vm.checkoutDesdeEspera()
                        nav.navigate("checkout")
                    },
                    onVolver = { nav.popBackStack() },
                )
            }
        }
    }
}

private fun deepLinkEspera(uri: Uri?): String? {
    if (uri == null) return null
    val path = uri.path.orEmpty()
    if (path.contains("/espera/")) return path.substringAfterLast('/')
    if (uri.host == "espera") return uri.lastPathSegment
    return null
}

/* ── ViewModel ── */

data class CatalogState(
    val events: List<CatalogEvent> = emptyList(),
    val query: String = "",
    val cargando: Boolean = false,
    val error: String? = null,
)

data class DetailState(
    val event: CatalogEvent? = null,
    val cargando: Boolean = false,
    val error: String? = null,
)

data class CheckoutState(
    val eventId: String = "",
    val eventTitle: String = "",
    val offerId: String? = null,
    val holdIds: List<String> = emptyList(),
    val seatSummary: String = "",
    val estimatedTotal: Double = 0.0,
    val expiresAt: String? = null,
    val config: PaymentConfig? = null,
    val busy: Boolean = false,
    val error: String? = null,
    val lastOrder: CreatedOrder? = null,
)

data class ResaleState(
    val listings: List<ResaleListing> = emptyList(),
    val sales: JSONArray? = null,
    val cargando: Boolean = false,
    val error: String? = null,
    val lastCheckout: ResaleCheckout? = null,
)

data class AccountState(val busy: Boolean = false, val error: String? = null, val aviso: String? = null)
data class WaitlistState(val claim: WaitlistClaim? = null, val cargando: Boolean = false, val error: String? = null)

class AppViewModel(context: android.content.Context) : ViewModel() {
    val session = SessionStore(context)
    private val api = ApiClient(session)
    private val buyer = BuyerApi(api, session)
    private val walletRepo = WalletRepository(context)

    private val _cartera = MutableStateFlow(EstadoCartera())
    val cartera: StateFlow<EstadoCartera> = _cartera
    private val _catalogo = MutableStateFlow(CatalogState())
    val catalogo: StateFlow<CatalogState> = _catalogo
    private val _detalle = MutableStateFlow(DetailState())
    val detalle: StateFlow<DetailState> = _detalle
    private val _checkout = MutableStateFlow(CheckoutState())
    val checkout: StateFlow<CheckoutState> = _checkout
    private val _reventa = MutableStateFlow(ResaleState())
    val reventa: StateFlow<ResaleState> = _reventa
    private val _cuenta = MutableStateFlow(AccountState())
    val cuenta: StateFlow<AccountState> = _cuenta
    private val _waitlist = MutableStateFlow(WaitlistState())
    val waitlist: StateFlow<WaitlistState> = _waitlist

    fun bootstrap() {
        cargarCartera()
        buscarEventos()
    }

    fun cargarCartera() {
        viewModelScope.launch {
            _cartera.value = _cartera.value.copy(cargando = true, error = null)
            try {
                val mine = runCatching { walletRepo.cargarMine(session.accessToken()) }.getOrNull()
                val ids = walletRepo.ordenesGuardadas().filter { !it.startsWith("mine:") }
                val porOrden = mutableListOf<Wallet>()
                var sync = mine?.sincronizada != false
                for (id in ids) {
                    try {
                        val r = walletRepo.cargar(id, session.accessToken())
                        porOrden += r.wallet
                        if (!r.sincronizada) sync = false
                    } catch (_: Exception) {
                        sync = false
                    }
                }
                val todas = ((mine?.carteras ?: emptyList()) + porOrden)
                    .sortedBy { it.event.startsAt ?: "9999" }
                _cartera.value = EstadoCartera(
                    carteras = todas,
                    cargando = false,
                    sincronizada = sync,
                    aviso = mine?.aviso ?: if (sync) null else "Sin conexión · copias guardadas",
                )
            } catch (e: Exception) {
                _cartera.value = _cartera.value.copy(
                    cargando = false,
                    error = e.message ?: "No se pudo cargar la cartera",
                )
            }
        }
    }

    fun agregarOrden(publicId: String) {
        val limpio = publicId.trim().uppercase()
        viewModelScope.launch {
            _cartera.value = _cartera.value.copy(cargando = true, error = null)
            try {
                val w = walletRepo.descargar(limpio, session.accessToken())
                walletRepo.guardar(w)
                cargarCartera()
            } catch (e: Exception) {
                _cartera.value = _cartera.value.copy(
                    cargando = false,
                    error = (e as? WalletException)?.message
                        ?: "No se pudo añadir. Revisa el código y tu conexión.",
                )
            }
        }
    }

    fun olvidar(publicId: String) {
        walletRepo.olvidar(publicId)
        cargarCartera()
    }

    fun reenviar(wallet: Wallet) {
        viewModelScope.launch {
            try {
                val id = wallet.tickets.firstOrNull()?.orderPublicId ?: wallet.publicId
                if (id.startsWith("mine:")) {
                    _cartera.value = _cartera.value.copy(error = "Abre la orden desde el correo para reenviar.")
                    return@launch
                }
                buyer.resendTickets(id, null)
                _cartera.value = _cartera.value.copy(error = null, aviso = "Reenviamos los boletos al correo de la orden.")
            } catch (e: Exception) {
                _cartera.value = _cartera.value.copy(error = (e as? ApiException)?.message ?: e.message)
            }
        }
    }

    fun transferir(ticketId: String, email: String, message: String, onDone: () -> Unit) {
        viewModelScope.launch {
            try {
                if (!session.isLoggedIn()) {
                    _cartera.value = _cartera.value.copy(error = "Entra a tu cuenta para transferir.")
                    return@launch
                }
                buyer.transferTicket(ticketId, email, message)
                onDone()
                cargarCartera()
            } catch (e: Exception) {
                _cartera.value = _cartera.value.copy(error = (e as? ApiException)?.message ?: e.message)
            }
        }
    }

    fun setQuery(q: String) {
        _catalogo.value = _catalogo.value.copy(query = q)
    }

    fun buscarEventos() {
        viewModelScope.launch {
            _catalogo.value = _catalogo.value.copy(cargando = true, error = null)
            try {
                val list = buyer.listEvents(_catalogo.value.query.ifBlank { null })
                _catalogo.value = _catalogo.value.copy(events = list, cargando = false)
            } catch (e: Exception) {
                _catalogo.value = _catalogo.value.copy(
                    cargando = false,
                    error = (e as? ApiException)?.message ?: "Sin señal. Intenta de nuevo.",
                )
            }
        }
    }

    fun cargarEvento(slug: String) {
        viewModelScope.launch {
            _detalle.value = DetailState(cargando = true)
            try {
                val ev = buyer.eventBySlug(slug)
                _detalle.value = DetailState(event = ev)
            } catch (e: Exception) {
                _detalle.value = DetailState(error = (e as? ApiException)?.message ?: e.message)
            }
        }
    }

    fun apartar(
        event: CatalogEvent,
        offer: OfferCard,
        qty: Int,
        accessCode: String,
        best: Boolean,
        onOk: () -> Unit,
    ) {
        viewModelScope.launch {
            _detalle.value = _detalle.value.copy(cargando = true, error = null)
            try {
                val hold = if (best) {
                    buyer.createBestAvailableHold(event.id, offer.id, qty, accessCode.ifBlank { null })
                } else {
                    buyer.createGaHold(event.id, offer.id, qty, accessCode.ifBlank { null })
                }
                val config = buyer.paymentConfig(event.id)
                _checkout.value = CheckoutState(
                    eventId = event.id,
                    eventTitle = event.title,
                    offerId = offer.id,
                    holdIds = hold.holdIds,
                    seatSummary = hold.resumen(),
                    estimatedTotal = offer.allInPrice * hold.holdIds.size.coerceAtLeast(qty),
                    expiresAt = hold.expiresAt,
                    config = config,
                )
                _detalle.value = _detalle.value.copy(cargando = false)
                onOk()
            } catch (e: Exception) {
                _detalle.value = _detalle.value.copy(cargando = false, error = mensajeHoldError(e))
            }
        }
    }

    fun pagar(name: String, email: String, phone: String, method: String, installments: Int?) {
        val c = _checkout.value
        if (c.holdIds.isEmpty()) {
            _checkout.value = c.copy(error = "El apartado venció. Vuelve a la ficha.")
            return
        }
        viewModelScope.launch {
            _checkout.value = c.copy(busy = true, error = null)
            try {
                val order = buyer.createOrder(
                    eventId = c.eventId,
                    holdIds = c.holdIds,
                    offerId = c.offerId,
                    buyerName = name,
                    buyerEmail = email,
                    buyerPhone = phone.ifBlank { null },
                    paymentMethod = method,
                    installments = installments,
                )
                order.accessToken?.let { /* guest access token kept client-side if needed */ }
                // Si pagó de contado sin redirect, refrescar cartera.
                if (order.paymentAction?.redirectUrl.isNullOrBlank() &&
                    order.paymentAction?.reference.isNullOrBlank()
                ) {
                    runCatching { walletRepo.descargar(order.publicId, order.accessToken) }
                        .onSuccess { walletRepo.guardar(it) }
                    cargarCartera()
                } else if (!order.accessToken.isNullOrBlank()) {
                    runCatching { walletRepo.descargar(order.publicId, order.accessToken) }
                        .getOrNull()?.let { /* still pending */ }
                }
                _checkout.value = _checkout.value.copy(busy = false, lastOrder = order)
            } catch (e: Exception) {
                _checkout.value = _checkout.value.copy(
                    busy = false,
                    error = (e as? ApiException)?.message ?: e.message,
                )
            }
        }
    }

    fun cargarReventa() {
        viewModelScope.launch {
            _reventa.value = _reventa.value.copy(cargando = true, error = null)
            try {
                val list = buyer.listResale()
                val sales = if (session.isLoggedIn()) runCatching { buyer.myResaleSales() }.getOrNull() else null
                _reventa.value = ResaleState(listings = list, sales = sales, cargando = false)
            } catch (e: Exception) {
                _reventa.value = _reventa.value.copy(
                    cargando = false,
                    error = (e as? ApiException)?.message ?: "No se pudo cargar la reventa.",
                )
            }
        }
    }

    fun comprarReventa(listingId: String) {
        viewModelScope.launch {
            try {
                val co = buyer.buyResale(listingId)
                _reventa.value = _reventa.value.copy(lastCheckout = co, error = null)
            } catch (e: Exception) {
                _reventa.value = _reventa.value.copy(error = (e as? ApiException)?.message ?: e.message)
            }
        }
    }

    fun venderReventa(ticketId: String, price: Double) {
        viewModelScope.launch {
            try {
                buyer.createResaleListing(ticketId, price)
                cargarReventa()
            } catch (e: Exception) {
                _reventa.value = _reventa.value.copy(error = (e as? ApiException)?.message ?: e.message)
            }
        }
    }

    fun login(email: String, password: String) {
        viewModelScope.launch {
            _cuenta.value = AccountState(busy = true)
            try {
                session.login(api, email, password)
                _cuenta.value = AccountState(aviso = "Sesión iniciada")
                cargarCartera()
            } catch (e: Exception) {
                _cuenta.value = AccountState(
                    error = when {
                        e is ApiException && e.code == 401 -> "Correo o contraseña incorrectos."
                        else -> (e as? ApiException)?.message ?: "No se pudo entrar. Revisa tu conexión."
                    },
                )
            }
        }
    }

    fun logout() {
        session.logout()
        _cuenta.value = AccountState(aviso = "Sesión cerrada. Tus boletos guardados siguen en el teléfono.")
        cargarCartera()
    }

    fun unirseEspera(eventId: String, offerId: String?, onOk: () -> Unit) {
        viewModelScope.launch {
            try {
                val email = session.userEmail()
                    ?: _cuenta.value.let { null }
                val mail = email ?: return@launch run {
                    _cuenta.value = AccountState(error = "Indica tu correo entrando a la cuenta o en el formulario web.")
                    onOk()
                }
                buyer.joinWaitlist(eventId, mail, offerId, 1)
                _cuenta.value = AccountState(aviso = "Te apuntamos a la lista de espera.")
                onOk()
            } catch (e: Exception) {
                _detalle.value = _detalle.value.copy(error = (e as? ApiException)?.message ?: e.message)
            }
        }
    }

    fun abrirEspera(token: String) {
        viewModelScope.launch {
            _waitlist.value = WaitlistState(cargando = true)
            try {
                _waitlist.value = WaitlistState(claim = buyer.waitlistClaim(token))
            } catch (e: Exception) {
                _waitlist.value = WaitlistState(error = (e as? ApiException)?.message ?: e.message)
            }
        }
    }

    fun convertirEspera(token: String) {
        viewModelScope.launch {
            _waitlist.value = _waitlist.value.copy(cargando = true, error = null)
            try {
                buyer.convertWaitlistClaim(token)
                _waitlist.value = WaitlistState(claim = buyer.waitlistClaim(token))
            } catch (e: Exception) {
                _waitlist.value = _waitlist.value.copy(
                    cargando = false,
                    error = (e as? ApiException)?.message ?: e.message,
                )
            }
        }
    }

    fun checkoutDesdeEspera() {
        val claim = _waitlist.value.claim ?: return
        val eventId = claim.eventId ?: return
        viewModelScope.launch {
            val config = runCatching { buyer.paymentConfig(eventId) }.getOrNull()
            _checkout.value = CheckoutState(
                eventId = eventId,
                eventTitle = claim.eventTitle.orEmpty(),
                offerId = claim.offerId,
                holdIds = claim.holdIds,
                seatSummary = "${claim.holdIds.size} boleto(s) · lista de espera",
                estimatedTotal = 0.0,
                expiresAt = claim.expiresAt,
                config = config,
            )
        }
    }

    class Factory(private val context: android.content.Context) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = AppViewModel(context) as T
    }
}
