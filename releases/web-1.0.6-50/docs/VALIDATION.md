# Validação reaproveitada — sem repetir suítes

As evidências anteriores correspondem às fontes congeladas copiadas sem alteração: 46 testes VM/widget/componentes aprovados, nove verificações com SDK Web e emuladores e três verificações adicionais de escrita pendente/reconexão. O build release foi gerado antes desta organização Git. O JavaScript publicado não contém as seis chamadas comerciais F9 ausentes.

Os quatro arquivos de teste e seus auxiliares estão em app/test/. Resultados preservados: test/sales_writers_characterization_test.dart, test/prod_p0_03_a_s01_characterization_test.dart, test/subscription_billing_access_test.dart, test/account_legal_links_test.dart. Não executar todos os testes da raiz F7 como se validassem este snapshot.

O pacote publicado teve 54 arquivos conferidos por HTTP/SHA256, e a tela de login carregou. Nenhuma venda, recebimento ou cobrança real foi criada para a validação de publicação. Esta etapa Git verificou apenas igualdade dos arquivos selecionados, fechamento dos imports, segurança da seleção e diffs. Não repetiu build nem testes funcionais.

Limites herdados: nova invocação após commit com resposta perdida pode duplicar lançamentos; não há idempotência durável F9. Fiado legado não ganha validação transacional adicional de estoque/lotes. Quitação individual markOrderAsPaid não é a mesma transação atômica de Abater Saldo. A fila SQLite offline não é suportada pela Web como na base publicada. A suíte genérica Chrome/IndexedDB F9 ficou travada antes de iniciar testes e não foi contabilizada como aprovada; as verificações essenciais de navegador usaram SDK Web real nos emuladores.
