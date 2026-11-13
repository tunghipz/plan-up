// swift-tools-version:5.3

import PackageDescription

let package = Package(
  name: "tauri-plugin-backup-folder",
  platforms: [
    .iOS(.v14),
  ],
  products: [
    .library(
      name: "tauri-plugin-backup-folder",
      type: .static,
      targets: ["tauri-plugin-backup-folder"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-backup-folder",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
