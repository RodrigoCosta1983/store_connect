import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/providers/cart_provider.dart';
import 'fixtures/sales_characterization_fixtures.dart';

void main() {
  test('conditional checkout clear preserves cart repopulated by a listener', () {
    final cart = CartProvider()..addItem(characterizationProduct());
    addTearDown(cart.dispose);
    final original = cart.revision;
    var repopulated = false;
    cart.addListener(() {
      if (cart.items.isEmpty && !repopulated) {
        repopulated = true;
        cart.addItem(characterizationProduct(price: 7));
      }
    });
    expect(cart.clearIfCurrent(original), false);
    expect(cart.totalAmount, 7);
    expect(cart.clearIfCurrent(original), false);
    expect(cart.totalAmount, 7);
  });
}
