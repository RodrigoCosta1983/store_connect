import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:google_sign_in/google_sign_in.dart';

import '../firebase/app_environment.dart';

GoogleSignIn createGoogleSignIn() {
  final environment = AppConfiguration.environment;
  // Android resolves default_web_client_id from its flavor's Google Services.
  return GoogleSignIn(
    clientId: kIsWeb ? environment.googleSignInWebClientId : null,
  );
}

/// Firebase authentication uses the popup on Web and native Google Sign-In elsewhere.
Future<UserCredential?> signInWithGoogle() async {
  final environment = AppConfiguration.environment;
  final auth = FirebaseAuth.instance;
  environment.validateIdentity(
    projectId: auth.app.options.projectId,
    appId: auth.app.options.appId,
    web: kIsWeb,
  );

  if (kIsWeb) {
    return await auth.signInWithPopup(GoogleAuthProvider());
  }

  final googleUser = await createGoogleSignIn().signIn();
  if (googleUser == null) return null;

  final googleAuth = await googleUser.authentication;
  final credential = GoogleAuthProvider.credential(
    accessToken: googleAuth.accessToken,
    idToken: googleAuth.idToken,
  );
  return await auth.signInWithCredential(credential);
}