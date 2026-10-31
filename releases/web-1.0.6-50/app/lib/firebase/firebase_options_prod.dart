// Official Firebase client SDK configuration. Do not log options.
import 'package:firebase_core/firebase_core.dart';

class ProdFirebaseOptions {
  static const android = FirebaseOptions(
    apiKey: 'AIzaSyA3glXnB8XDm1IUFfKUGmaNcULnUZF_hrM',
    appId: '1:294766590074:android:f993b08bb3f300b2afe3c3',
    messagingSenderId: '294766590074',
    projectId: 'store-connect-app',
    storageBucket: 'store-connect-app.firebasestorage.app',
  );

  static const web = FirebaseOptions(
    apiKey: 'AIzaSyAXvWxIcts2Nd8QW-prkD3rJHKxqMIyzUg',
    appId: '1:294766590074:web:fbe25231b8ef11d8afe3c3',
    messagingSenderId: '294766590074',
    projectId: 'store-connect-app',
    authDomain: 'store-connect-app.firebaseapp.com',
    storageBucket: 'store-connect-app.firebasestorage.app',
    measurementId: 'G-KYVFYLZHSQ',
  );
}
