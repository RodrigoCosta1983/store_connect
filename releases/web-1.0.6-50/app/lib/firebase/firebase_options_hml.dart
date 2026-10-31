// Official Firebase client SDK configuration. Do not log options.
import 'package:firebase_core/firebase_core.dart';

class HmlFirebaseOptions {
  static const android = FirebaseOptions(
    apiKey: 'AIzaSyCOqzr__maSqX2y1lkLQMBL3lI_sAeDy5Y',
    appId: '1:324469869942:android:4482c313ccd8c0e9ae7e57',
    messagingSenderId: '324469869942',
    projectId: 'store-connect-hml',
    storageBucket: 'store-connect-hml.firebasestorage.app',
  );

  static const web = FirebaseOptions(
    apiKey: 'AIzaSyDFvRD4BMdH7nlO0yJwVztw2pdgZJ4uvxQ',
    appId: '1:324469869942:web:0d50059ae896f7e3ae7e57',
    messagingSenderId: '324469869942',
    projectId: 'store-connect-hml',
    authDomain: 'store-connect-hml.firebaseapp.com',
    storageBucket: 'store-connect-hml.firebasestorage.app',
  );
}
