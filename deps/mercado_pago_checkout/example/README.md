# mercado_pago_checkout_example

Mercado Pago's Flutter checkout library

## What is this?

Flutter implementation of [MercadoPago Mobile Checkout](https://www.mercadopago.com.ar/developers/es/guides/payments/mobile-checkout/introduction/)

## Getting Started

* Create an account in MercadoPago, you may need to choose the country where you want to accept payments.
* Create an [Application](https://applications.mercadopago.com/)
* Go to the credentials page (the url may change depending the country, but looks like https://www.mercadopago.com/mla/account/credentials) and get the Public Key of the new app
  ** SECURITY WARNING: Do not use the Access Token, ClientID or Client Secret in your mobile application.
* Call your backend to create a Checkout Preference and get a PreferenceId
  ** TODO: Add more documentation about preferences
* In your Flutter code, call `MercadoPagoCheckout.startCheckout()` to allow the user to pay
* Save the payment response into your database.

## Setup

### Android

Nothing special to do, just add the plugin and use it.

### iOS

At the moment we need to setup a UINavigationController manually because the one that Flutter provides do not work with MercadoPago px-ios.

You need to setup your root view controller as UINavigationController in your AppDelegate of the ios folder of your app:

```swift
// AppDelegate.swift

import UIKit
import Flutter

@UIApplicationMain
@objc class AppDelegate: FlutterAppDelegate {
  var navigationController: UINavigationController?;

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // Add this line before GeneratedPluginRegistrant
    let flutterViewController: FlutterViewController = window?.rootViewController as! FlutterViewController

    // This line is added by the Flutter App Generator
    GeneratedPluginRegistrant.register(with: self)

    // Add these lines after GeneratedPluginRegistrant
    self.navigationController = UINavigationController(rootViewController: flutterViewController);
    self.navigationController?.setNavigationBarHidden(true, animated: false);

    self.window = UIWindow(frame: UIScreen.main.bounds);
    self.window.rootViewController = self.navigationController;
    self.window.makeKeyAndVisible();
    // End of edit

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
```

Also, by default Flutter creates the iOS app to target a version that is not supported by px-ios. So, you need to open `ios/Podfile`, uncomment and edit the line that says:

```
# Uncomment this line to define a global platform for your project
platform :ios, '8.0'
```

and change it to

```
# Uncomment this line to define a global platform for your project
platform :ios, '10.0'
```

## Installation

Add this to your package's pubspec.yaml file:

```yaml
dependencies:
  mercado_pago__checkout: ^0.0.1
```

Add the following import to your Dart code:

```dart
import 'package:mercado_pago__checkout/mercado_pago_checkout.dart';
```
