import 'dart:io';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/cart_item_model.dart';
import '../models/customer_model.dart';
import '../models/product_model.dart';
import '../providers/cart_provider.dart';
import '../screens/public/public_catalog_screen.dart';
import '../services/product_variants_form_draft.dart';
import '../services/variant_product_registration.dart';
import '../services/variant_sale.dart';
import '../widgets/product_variants_form.dart';
import '../widgets/variant_product_management_dialog.dart';
import '../widgets/variant_sale_widgets.dart';
import 'f10_local_backend.dart';

class _NoNetwork extends HttpOverrides {
  @override HttpClient createHttpClient(SecurityContext? context) =>
    throw UnsupportedError('PREVIEW OFFLINE: rede desabilitada. Nenhuma operação real.');
}
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  HttpOverrides.global = _NoNetwork();
  // Deliberately no Firebase.initializeApp, Auth, App Check, remote config or login.
  try {
    final local = await F10LocalBackend.open();
    runApp(MultiProvider(providers: [ChangeNotifierProvider.value(value: local),
      ChangeNotifierProvider(create: (_) => CartProvider())], child: const F10FeedbackApp()));
  } catch (e) {
    runApp(MaterialApp(home: Scaffold(body: SafeArea(child: Padding(padding: const EdgeInsets.all(24),
      child: Text('PREVIEW BLOQUEADO\nNão foi possível abrir a base fictícia local.\n$e\nNenhum acesso remoto foi iniciado.'))))));
  }
}
String money(int cents) => 'R\$ ${(cents / 100).toStringAsFixed(2).replaceAll('.', ',')}';
const disclaimer = 'DEMONSTRAÇÃO — dados fictícios — nenhuma operação real';

class F10FeedbackApp extends StatelessWidget {
  const F10FeedbackApp({super.key});
  @override Widget build(BuildContext context) => MaterialApp(
    title: 'Store&Connect F10 Preview', debugShowCheckedModeBanner: false,
    theme: ThemeData(colorSchemeSeed: const Color(0xff5621a8), useMaterial3: true),
    builder: (context, child) => Column(children: [
      Material(color: const Color(0xff5621a8), child: SafeArea(bottom: false, child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        child: Row(children: [const Icon(Icons.science, color: Colors.amber), const SizedBox(width: 8),
          Expanded(child: Text(disclaimer, style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold)))])))),
      Expanded(child: child ?? const SizedBox()),
    ]), home: const _Home());
}
class _Home extends StatelessWidget {
  const _Home();
  @override Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('F10 Preview')),
    body: ListView(padding: const EdgeInsets.all(16), children: [
      const Text('Loja de roupas fictícia', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
      const Text('Sem login, internet, cobrança ou sincronização. Este aplicativo coexiste com o comercial e usa uma base local própria. '
        'Os componentes operacionais reutilizados recebem um simulador local no lugar do backend. Nenhum resultado representa homologação.'),
      const SizedBox(height: 16),
      for (final entry in <(String, String, IconData, Widget)>[
        ('A · Gestão de variantes', 'Formulários reais · cadastro, preço, custo, atributos, estoque/lotes e arquivo local', Icons.style, const _Management()),
        ('B/C · PDV e carrinho misto', 'Seleção e carrinho reais · confirmação, fiado e fila simulados localmente', Icons.point_of_sale, const _POS()),
        ('D · Catálogo e solicitação', 'Tela pública real em preview · pedido fictício sem reserva', Icons.storefront, const _Catalog()),
        ('E · Histórico e indicadores', 'Snapshots locais · recibo, custos e parcelas sintéticos', Icons.receipt_long, const _History()),
        ('F · Recuperação', 'Componente real · cenários separados com fixtures explícitas', Icons.manage_search, const _Recovery()),
        ('G · Fiscal, backup e restauração', 'Configuração visual e limites · sem provider ou restore remoto', Icons.policy, const _Limits()),
      ]) Card(child: ListTile(leading: Icon(entry.$3), title: Text(entry.$1), subtitle: Text(entry.$2), trailing: const Icon(Icons.chevron_right),
        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => entry.$4)))),
      const Padding(padding: EdgeInsets.all(8), child: Text('Sugestão: comece pela Camiseta Azul/P (5), Azul/M (8), Preto/G (3), a R\$ 42,90. '
        'Cadastros e vendas simuladas ficam neste aplicativo. O carrinho em edição fica em memória; intenções preparadas usam SQLite.')),
    ]));
}
class _Management extends StatelessWidget {
  const _Management();
  @override Widget build(BuildContext context) {
    final local = context.watch<F10LocalBackend>();
    return Scaffold(appBar: AppBar(title: const Text('Gestão F10 · local')),
      floatingActionButton: FloatingActionButton.extended(onPressed: () => Navigator.push(context,
        MaterialPageRoute(builder: (_) => const _Register())), icon: const Icon(Icons.add), label: const Text('Novo pai')),
      body: ListView(padding: const EdgeInsets.fromLTRB(12,12,12,100), children: [
        const Text('O formulário de gestão abaixo é o utilizado no aplicativo real. Aqui, cada alteração é atendida pelo simulador local. '
          'As validações de autorização e transação do servidor não estão sendo exercitadas.'),
        for (final id in local.productIds) Card(child: ListTile(title: Text(local.rows(id).first['data']['name'] as String),
          subtitle: Text('Pai não vendável · ${local.rows(id).length - 1} opções · ${local.rows(id).first['data']['isArchived'] == true ? 'Arquivado' : 'Ativo'}'),
          trailing: const Icon(Icons.edit), onTap: () => showDialog<void>(context: context, builder: (_) =>
            VariantProductManagementDialog(storeId: previewStore, productId: id, factory: local.managementAccess)))),
      ]));
  }
}
class _Register extends StatefulWidget {
  const _Register();
  @override State<_Register> createState() => _RegisterState();
}
class _RegisterState extends State<_Register> {
  final draft = ProductVariantsFormDraft();
  final name = TextEditingController(), cod = TextEditingController(), price = TextEditingController(text: '42,90'), cost = TextEditingController();
  String? error;
  bool busy = false;
  @override void initState() { super.initState(); draft.setEnabled(true); draft.addAttribute('Cor', 'Azul, Preto'); draft.addAttribute('Tamanho', 'P, M, G'); }
  @override void dispose() { draft.dispose(); for (final c in [name,cod,price,cost]) { c.dispose(); } super.dispose(); }
  @override Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('Novo produto · fictício')),
    body: ListView(padding: const EdgeInsets.all(16), children: [
      const Text('Componente real de cadastro de combinações. Gravação adaptada exclusivamente à base local do preview.'),
      TextField(controller: name, decoration: const InputDecoration(labelText: 'Nome do produto pai')),
      TextField(controller: cod, decoration: const InputDecoration(labelText: 'COD do pai')),
      TextField(controller: price, decoration: const InputDecoration(labelText: 'Preço base (R\$)')),
      TextField(controller: cost, decoration: const InputDecoration(labelText: 'Custo base (vazio = desconhecido)')),
      ProductVariantsForm(draft: draft, parentCod: () => cod.text),
      if (error != null) Text(error!, style: const TextStyle(color: Colors.red)),
      FilledButton(onPressed: busy ? null : () async {
        setState(() { busy = true; error = null; });
        try {
          await context.read<F10LocalBackend>().register(name.text, cod.text, variantMoneyCents(price.text),
            cost.text.trim().isEmpty ? null : variantMoneyCents(cost.text), draft);
          if (context.mounted) Navigator.pop(context);
        } catch (e) { if (mounted) setState(() => error = '$e'); }
        finally { if (mounted) setState(() => busy = false); }
      }, child: const Text('Guardar somente nesta demonstração')),
    ]));
}
Future<void> payment(BuildContext context, {bool recovery = false, String? fixture}) async {
  final local = context.read<F10LocalBackend>();
  await showModalBottomSheet<void>(context: context, isScrollControlled: true, useSafeArea: true, builder: (_) =>
    VariantSalePayment(storeId: previewStore, notes: 'DEMONSTRAÇÃO LOCAL — sem operação real', recovery: recovery,
      factory: fixture == null ? local.saleAccess : (_) => local.recoveryFixture(fixture),
      customerPicker: (context, _) => showDialog<Customer>(context: context, builder: (ctx) => AlertDialog(
        title: const Text('Cliente fictício'), content: const Text('Cliente Demonstração · sem CPF, telefone, cadastro remoto ou cobrança.'),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, Customer(id: 'demo-customer', name: 'Cliente Demonstração')),
            child: const Text('Usar cliente fictício'))]))));
}
class _POS extends StatelessWidget {
  const _POS();
  @override Widget build(BuildContext context) {
    final local = context.watch<F10LocalBackend>(), cart = context.watch<CartProvider>();
    final cents = cart.variantItems.fold<int>(0, (s,l) => s + l.subtotalCents) +
      cart.simpleItems.values.fold<int>(0, (s,l) => s + (l.price * 100).round() * l.quantity);
    return Scaffold(appBar: AppBar(title: const Text('PDV · simulação local')),
      body: ListView(padding: const EdgeInsets.all(12), children: [
        const Text('Widgets reais de seleção, linhas, checkout e recuperação. Toda menção a servidor/confirmação nesta demonstração refere-se ao simulador SQLite local. '
          'PIX/cartão/fiado não cobram. Recuperar fila não significa sincronizar com Firebase.'),
        for (final id in local.productIds) SizedBox(height: 175, child: VariantParentSaleCard(storeId: previewStore, productId: id,
          name: local.rows(id).first['data']['name'] as String, factory: local.saleAccess)),
        Card(child: ListTile(title: const Text('Cinto sintético · produto simples'), subtitle: Text('R\$ 15,90 · Saldo local ${local.state['simpleStock']}'),
          trailing: IconButton(icon: const Icon(Icons.add_shopping_cart), onPressed: () => cart.addItem(Product(id: 'demo-belt', name: 'Cinto sintético', price: 15.90,
            quantidade: local.state['simpleStock'] as int, minimumStock: 1))))),
        const Divider(), const Text('Carrinho misto', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
        for (final line in cart.variantItems) VariantCartLineWidget(line: line),
        for (final line in cart.simpleItems.values) ListTile(title: Text(line.name), subtitle: Text('${line.quantity} × ${money((line.price * 100).round())}'),
          trailing: IconButton(icon: const Icon(Icons.remove_circle_outline), onPressed: () => cart.removeSingleItem(line.productId))),
        Text('Total: ${money(cents)} · $cents centavos', style: const TextStyle(fontSize: 22)),
        FilledButton(onPressed: cart.hasVariants ? () => payment(context) : null, child: const Text('Avaliar checkout simulado')),
        if (!cart.hasVariants) const Text('Selecione ao menos uma variante para avaliar o protocolo F10. Não há fallback F9.'),
        OutlinedButton(onPressed: () => payment(context, recovery: true), child: const Text('Consultar intenção / fila local')),
        TextButton(onPressed: cart.clear, child: const Text('Limpar somente carrinho em edição (não apaga intenções)')),
      ]));
  }
}
class _Catalog extends StatefulWidget {
  const _Catalog();
  @override State<_Catalog> createState() => _CatalogState();
}
class _CatalogState extends State<_Catalog> {
  final selected = <String, Map<String, dynamic>>{};
  String? error;
  @override Widget build(BuildContext context) {
    final local = context.watch<F10LocalBackend>();
    final total = selected.values.fold<int>(0, (s,i) => s + (i['quantity'] as int) * (i['unitPriceCents'] as int));
    return Scaffold(appBar: AppBar(title: const Text('Catálogo · pedido local')), body: ListView(padding: const EdgeInsets.all(16), children: [
      const Text('A tela pública real pode ser aberta abaixo em seu modo de pré-visualização. '
        'O formulário de pedido nesta página é um adaptador local: sem links, tokens, publicação, reserva ou venda.'),
      OutlinedButton(onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => PublicCatalogScreen.preview(data: local.catalogData()))),
        child: const Text('Abrir tela real do catálogo')),
      for (final id in local.productIds) SizedBox(height: 175, child: VariantParentSaleCard(storeId: previewStore, productId: id,
        name: local.rows(id).first['data']['name'] as String, factory: local.saleAccess, onSelected: (choice) => setState(() {
          final prior = selected[choice.key]; selected[choice.key] = {'productId': choice.productId, 'variantId': choice.variantId,
            'name': choice.name, 'quantity': (prior?['quantity'] as int? ?? 0) + 1, 'unitPriceCents': choice.unitPriceCents};
        }))),
      for (final key in selected.keys.toList()) ListTile(title: Text(selected[key]!['name'] as String),
        subtitle: Text('${selected[key]!['quantity']} × ${money(selected[key]!['unitPriceCents'] as int)}'),
        trailing: IconButton(icon: const Icon(Icons.remove_circle_outline), onPressed: () => setState(() {
          if (selected[key]!['quantity'] == 1) { selected.remove(key); } else { selected[key]!['quantity'] -= 1; }
        }))),
      Text('Pedido fictício: ${money(total)}'), if (error != null) Text(error!),
      FilledButton(onPressed: selected.isEmpty ? null : () async {
        try { await local.request(selected.values.toList()); if (mounted) setState(() { selected.clear(); error = 'Pedido salvo somente no preview. Sem venda ou reserva.'; }); }
        catch (e) { if (mounted) setState(() => error = '$e'); }
      }, child: const Text('Registrar pedido simulado')),
      for (final request in (local.state['requests'] as List).reversed) Card(child: ListTile(title: Text('Solicitação local · ${money(request['totalCents'] as int)}'),
        subtitle: Text((request['items'] as List).map((i) => '${i['quantity']} × ${i['name']}').join('\n')))),
    ]));
  }
}
class _History extends StatelessWidget {
  const _History();
  @override Widget build(BuildContext context) {
    final local = context.watch<F10LocalBackend>(), sales = local.state['sales'] as List;
    final total = sales.fold<int>(0, (s,v) => s + (v['totalCents'] as int));
    return Scaffold(appBar: AppBar(title: const Text('Histórico · fictício')), body: ListView(padding: const EdgeInsets.all(16), children: [
      const Text('Apresentação local com o modelo CartItem e descrições históricas reais. Não é a tela comercial conectada ao Firestore. '
        'Não há cash_flow remoto, emissão fiscal ou envio de recibo.'),
      Text('${sales.length} vendas simuladas · ${money(total)}', style: const TextStyle(fontSize: 22)),
      if (sales.isEmpty) const Text('Conclua uma simulação no PDV para ver o recibo e as parcelas aqui.'),
      for (var i = sales.length - 1; i >= 0; i--) Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('RECIBO SEM VALOR FISCAL · ${sales[i]['saleId']}', style: const TextStyle(fontWeight: FontWeight.bold)),
          Text('${sales[i]['paymentMethod']} · origem ${sales[i]['origin']} · ${money(sales[i]['totalCents'] as int)}'),
          for (final raw in sales[i]['items'] as List) Builder(builder: (_) {
            final item = CartItem.fromMap(copyMap(raw));
            return ListTile(contentPadding: EdgeInsets.zero, title: Text(item.receiptDescription),
              subtitle: Text('${item.quantity} × ${money((item.price * 100).round())}\nCusto: ${item.knownCostCents == null ? 'desconhecido' : money(item.knownCostCents!)}\n'
                'Identidade: ${item.productId} / ${item.variantId ?? 'simples'}'));
          }),
          for (var j = 0; j < (sales[i]['installments'] as List).length; j++) ListTile(
            title: Text('Parcela ${j + 1} · ${money(sales[i]['installments'][j]['amountCents'] as int)}'),
            subtitle: Text('Primeiro vencimento: ${sales[i]['installments'][j]['firstDueDate']} · datas subsequentes não simuladas'),
            trailing: sales[i]['installments'][j]['paid'] == true ? const Text('Recebida LOCAL') : TextButton(onPressed: () => local.receive(i,j), child: const Text('Simular recebimento'))),
          TextButton(onPressed: () => showDialog<void>(context: context, builder: (ctx) => AlertDialog(title: const Text('Snapshot local imutável'),
            content: SingleChildScrollView(child: SelectableText(const JsonEncoder.withIndent('  ').convert(sales[i]))),
            actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Fechar'))])), child: const Text('Ver snapshot do recibo')),
        ]))),
      const Text('PDF e devolução/troca: não disponíveis neste preview. Não foi conectado o gerador que pode buscar fontes na rede, nem writers reais de devolução.'),
    ]));
  }
}
class _Recovery extends StatelessWidget {
  const _Recovery();
  @override Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('Recuperação · fixtures')),
    body: ListView(padding: const EdgeInsets.all(16), children: [
      const Text('Este é o componente real de recuperação com evidências fictícias e bancos locais separados por cenário. '
        '“Servidor” significa apenas simulador. Nenhuma prova real é consultada. Unknown e identity-conflict continuam bloqueados; não existe forçar desbloqueio.'),
      for (final status in ['confirmed','rejected','unknown','identity-conflict']) Card(child: ListTile(title: Text(status),
        subtitle: Text(status == 'confirmed' || status == 'rejected' ? 'Resultado conclusivo SOMENTE na fixture; permite reconhecimento local.' : 'Sem prova conclusiva; preservar intenção e escalar ao suporte.'),
        trailing: const Icon(Icons.chevron_right), onTap: () => payment(context, recovery: true, fixture: status))),
    ]));
}
class _Limits extends StatelessWidget {
  const _Limits();
  @override Widget build(BuildContext context) {
    final local = context.watch<F10LocalBackend>();
    return Scaffold(appBar: AppBar(title: const Text('Fiscal e backup · limites')), body: ListView(padding: const EdgeInsets.all(16), children: [
      const ListTile(leading: Icon(Icons.block), title: Text('Emissão, cancelamento e consulta fiscal BLOQUEADOS'),
        subtitle: Text('Nenhum provider, credencial ou estabelecimento fiscal. Não serão inventados NCM/CFOP/CST. Avalie o editor real em Gestão → Dados fiscais; ele guarda somente valores digitados na base fictícia. Isso não valida tributação.')),
      const ListTile(leading: Icon(Icons.storage), title: Text('Backup local de demonstração'),
        subtitle: Text('O botão mostra o estado sintético em JSON. Não representa o contrato de backup completo F10 do servidor. Não exporta credenciais ou dados HML/PROD.')),
      OutlinedButton(onPressed: () => showDialog<void>(context: context, builder: (ctx) => AlertDialog(title: const Text('Snapshot fictício local'),
        content: SizedBox(width: 600, child: SingleChildScrollView(child: SelectableText(const JsonEncoder.withIndent('  ').convert(local.state)))),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Fechar'))])), child: const Text('Visualizar JSON local')),
      const ListTile(leading: Icon(Icons.lock), title: Text('Restore, importação e devoluções BLOQUEADOS'),
        subtitle: Text('Nenhum restore remoto ou importação de históricos. O preview não acessa hmlMigrationArchives. '
          'Restauração e devolução reais exigem contratos e homologação próprios; não há botão que apague intenções ou recomponha estoque por atalho.')),
      const Text('Este APK não aprova F9/F10, HML, Samsung, Google Play ou PROD. '
        'Depois do feedback, serão necessárias compilação dos fluxos operacionais, testes e homologação com backend HML autorizado.'),
    ]));
  }
}
