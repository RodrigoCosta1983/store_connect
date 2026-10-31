# R4-B/03 — Functions, revisão dirigida e provas negativas puras

Não há SDK Firebase, adaptador de contexto, transporte ou integração ao app
neste diretório. O validador não produz CheckoutContextBinding e nunca autoriza
runtime. Os planos opacos são fixtures de validação local, sem identidade SDK.

```powershell
node --test scripts/b4br4b03/functions-validator.test.cjs scripts/b4br4b03/review-functions.test.cjs
node scripts/b4br4b03/review-functions.cjs build/b4br4b03/nova-revisao.json
```

Saída deve ser nova em diretório existente. Exportação retorna 1/BLOQUEADO;
erro ou sobrescrita retorna 2. Testes passam com exit 0. Não inicializa SDK,
emulador ou rede, não instala pacotes e não executa os JS examinados.

O review seleciona exatamente os 20 IDs P0 de Functions da matriz 02, confere
hash da matriz/coleta e usa sourceEvidence/textEvidence anteriores. O JSON de
notas registra revisão manual dos trechos de origem e efeitos, não aprovação
automática. Todas as closures/destinos completos continuam PENDENTE; runtime
NÃO DEMONSTRADO e admission NOT_ADMITTED. Duas fontes suplementares de registro
e os trechos JS locais não representam revisão de toda a cadeia distribuída.

K14/K15 têm a proveniência da mensagem do usuário que recupera decisões de
18/10/2026. O transcript original e a aprovação normativa documental não foram
fornecidos. Não se reescrevem relatórios antigos, política ou review R3/R4-A.

O validador puro confere exatamente o perfil R3, origin configurado e URL
diagnóstica R2 `http://127.0.0.1:4471/diagnosticOnly`. Não amplia o manifesto para
essa porta nem libera operação real. Rejeita campos extras, perfil misto, aliases,
query/fragment, outro destino e identidade local desconhecida. WeakMap reconhece
somente planos emitidos pelo próprio validador; copiar/serializar ou usar plano
de outra fixture falha. Divergência observada, pedido de reconfiguração ou retire
tornam aquele plano local obsoleto, sem reset. Não existem listeners, geração
Auth, lifecycle SDK, fan-out ou autoridade B4-C neste mecanismo.

Cada resultado, inclusive o controle positivo, contém runtimeAuthorization=false
e sdkAdmission=BLOCKED. Um descritor conhecido não é observação viva do SDK.
Mudança externa não observável com os mesmos descritores continua impossível
de detectar por esse validador. Não há mocks/stubs de Firebase nem teste que
alegue equivalente à reprodução histórica SDK.

Histórico: instanceFor recupera o mesmo cache app/região; useFunctionsEmulator
muda _origin Dart, sem mudar campos de _coherent/capture ou geração Auth do
protótipo. A aplicação Web de origin no JS ocorre em call/stream. O teste antigo
não invoca callable; prova que o receipt não detecta a configuração divergente.
Sua expectativa null permanece intacta e historicamente reprovada.

URL explícita chega a httpsCallableFromURL/callAtURL e evita derivar a URL inicial
por _url(name). Não congela Auth/App Check, provider, sessão, redirects ou runtime.
O postJSON do ESM local não especifica redirect:error; não se deduz segurança
de redirecionamento por URL fixa. Headers são obtidos por await. No código
examinado, cancelAllRequests compete com postJSON após o await: não garante que
delete impedirá um envio iniciado depois da obtenção de headers. Isso é inferência
estática limitada, não ensaio de corrida. K16 continua bloqueado.
