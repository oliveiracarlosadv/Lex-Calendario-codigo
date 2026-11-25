// Lex Calendário — notificador nativo do macOS.
// Fica em "Lex Calendário.app/Contents/MacOS/LexNotifier": as notificações aparecem como
// "Lex Calendário" na Central de Notificações (com o pedido de permissão do próprio macOS).
//
// Uso: LexNotifier "Título" "Mensagem"     ·     LexNotifier --autorizar
import Foundation
import UserNotifications

let args = CommandLine.arguments
let center = UNUserNotificationCenter.current()
let done = DispatchSemaphore(value: 0)

center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
    guard granted, args.count >= 2, args[1] != "--autorizar" else {
        done.signal()
        return
    }
    let content = UNMutableNotificationContent()
    content.title = args[1]
    content.body = args.count >= 3 ? args[2] : ""
    content.sound = .default
    let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
    center.add(request) { _ in done.signal() }
}

_ = done.wait(timeout: .now() + 15)
// Dá tempo de o sistema registrar a notificação antes de encerrar
Thread.sleep(forTimeInterval: 0.5)
