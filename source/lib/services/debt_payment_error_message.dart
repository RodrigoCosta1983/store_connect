import 'package:cloud_functions/cloud_functions.dart';

String debtPaymentErrorMessage(Object error) {
  if (error is FirebaseFunctionsException) {
    switch (error.code) {
      case 'not-found':
      case 'unimplemented':
        return 'Serviço de recebimento indisponível neste ambiente. A tentativa foi preservada para conferência.';
      case 'unauthenticated':
        return 'Entre novamente na sua conta para consultar o recebimento.';
      case 'permission-denied':
        return 'Sua conta não tem permissão para este recebimento.';
      case 'unavailable':
      case 'deadline-exceeded':
        return 'Não foi possível confirmar o recebimento. Verifique sua conexão e consulte o resultado antes de repetir.';
    }
  }
  if (error is StateError && error.message.toString().contains('Recebimento pendente')) {
    return 'Há um recebimento aguardando confirmação. Consulte o recebimento antes de iniciar outro.';
  }
  if (error is ArgumentError) {
    return 'Informe um valor positivo com até duas casas decimais.';
  }
  return 'Recebimento não confirmado. Consulte o resultado antes de tentar novamente.';
}
