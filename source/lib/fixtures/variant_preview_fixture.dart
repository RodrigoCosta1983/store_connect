import '../services/variant_preview_state.dart';

/// Creates a separate immutable synthetic snapshot for every preview.
VariantPreviewData syntheticVariantPreview() => VariantPreviewData({
  'scope': {
    'projectId': 'demo-f10-c4-a',
    'uid': 'synthetic-admin',
    'storeId': 'synthetic-store',
  },
  'productId': 'synthetic-shirt',
  'name': 'Camiseta de demonstração',
  'cod': 'DEMO-BASE',
  'isArchived': false,
  'baseline': {'seconds': '1792152000', 'nanoseconds': 123456000},
  'definitions': [
    {
      'attributeId': 'color',
      'label': 'Cor',
      'values': [
        {'valueId': 'blue', 'label': 'Azul'},
        {'valueId': 'red', 'label': 'Vermelho'},
      ],
    },
    {
      'attributeId': 'size',
      'label': 'Tamanho',
      'values': [
        {'valueId': 'm', 'label': 'M'},
        {'valueId': 'l', 'label': 'G'},
      ],
    },
  ],
  'variants': [
    {
      'variantId': 'synthetic-blue-m',
      'name': 'Azul M',
      'cod': 'DEMO-AZ-M',
      'attributes': {'color': 'blue', 'size': 'm'},
      'quantidade': 5,
      'lotes': [],
      'isArchived': false,
      'baseline': {'seconds': '1792152001', 'nanoseconds': 654321000},
    },
    {
      'variantId': 'synthetic-red-l',
      'name': 'Vermelho G',
      'attributes': {'color': 'red', 'size': 'l'},
      'quantidade': 3,
      'lotes': [
        {
          'quantidade': 3,
          'validade': {'seconds': '1893456000', 'nanoseconds': 123456789},
          'unknownMetadata': {'retained': true},
        },
      ],
      'isArchived': false,
      'baseline': {'seconds': '1792152002', 'nanoseconds': 111222000},
    },
    {
      'variantId': 'synthetic-red-m',
      'name': 'Vermelho M',
      'cod': 'DEMO-ARQ',
      'attributes': {'color': 'red', 'size': 'm'},
      'quantidade': 2,
      'lotes': [],
      'isArchived': true,
      'baseline': {'seconds': '1792152003', 'nanoseconds': 222333000},
    },
  ],
});
