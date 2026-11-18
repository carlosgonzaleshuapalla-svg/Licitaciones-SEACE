// Lee el texto de un PDF: el texto propio si lo tiene y, si la página es una
// imagen escaneada, OCR con Vision (todo local en la Mac, sin red).
//
//   leer_documento <archivo.pdf> [maxPaginas]   → texto por stdout, "--- Página N ---" entre páginas
//
// Códigos de salida: 0 ok · 2 argumentos · 3 no se pudo abrir · 4 PDF con clave.
// Lo usa backend/src/bases.js para buscar si las bases piden experiencia.
import AppKit
import Foundation
import PDFKit
import Vision

let argumentos = CommandLine.arguments
guard argumentos.count >= 2 else {
    FileHandle.standardError.write("Uso: leer_documento <archivo.pdf> [maxPaginas]\n".data(using: .utf8)!)
    exit(2)
}
let maxPaginas = argumentos.count >= 3 ? max(1, Int(argumentos[2]) ?? 40) : 40
let DPI: CGFloat = 200
let MIN_TEXTO_PROPIO = 40

guard let documento = PDFDocument(url: URL(fileURLWithPath: argumentos[1])) else { exit(3) }
if documento.isLocked { exit(4) }

func rotar(_ imagen: CGImage, grados: Int) -> CGImage? {
    let girar = grados == 90 || grados == 270
    let ancho = girar ? imagen.height : imagen.width
    let alto = girar ? imagen.width : imagen.height
    guard let ctx = CGContext(
        data: nil, width: ancho, height: alto, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return nil }
    ctx.translateBy(x: CGFloat(ancho) / 2, y: CGFloat(alto) / 2)
    ctx.rotate(by: -CGFloat(grados) * .pi / 180)
    ctx.draw(imagen, in: CGRect(x: -CGFloat(imagen.width) / 2, y: -CGFloat(imagen.height) / 2,
                                width: CGFloat(imagen.width), height: CGFloat(imagen.height)))
    return ctx.makeImage()
}

/// Texto reconocido, de arriba abajo; las celdas de una misma fila se unen con espacios.
func reconocer(_ imagen: CGImage) -> String {
    let pedido = VNRecognizeTextRequest()
    pedido.recognitionLevel = .accurate
    pedido.usesLanguageCorrection = true
    let soportados = (try? VNRecognizeTextRequest.supportedRecognitionLanguages(for: .accurate, revision: pedido.revision)) ?? []
    pedido.recognitionLanguages = soportados.contains("es-ES") ? ["es-ES"] : []
    let manejador = VNImageRequestHandler(cgImage: imagen, options: [:])
    do { try manejador.perform([pedido]) } catch { return "" }
    let lineas = (pedido.results ?? []).compactMap { obs -> (CGFloat, CGFloat, String)? in
        guard let mejor = obs.topCandidates(1).first else { return nil }
        return (obs.boundingBox.midY, obs.boundingBox.minX, mejor.string)
    }
    // Filas: mismo alto (con tolerancia) → una línea, de izquierda a derecha.
    var filas: [[(CGFloat, CGFloat, String)]] = []
    for l in lineas.sorted(by: { $0.0 > $1.0 }) {
        if let ultima = filas.last, abs(ultima[0].0 - l.0) < 0.008 {
            filas[filas.count - 1].append(l)
        } else {
            filas.append([l])
        }
    }
    return filas.map { $0.sorted { $0.1 < $1.1 }.map { $0.2 }.joined(separator: "   ") }.joined(separator: "\n")
}

func renderizar(_ pagina: PDFPage) -> CGImage? {
    let caja = pagina.bounds(for: .mediaBox)
    let escala = DPI / 72
    let tam = NSSize(width: caja.width * escala, height: caja.height * escala)
    let imagen = pagina.thumbnail(of: tam, for: .mediaBox)
    var rect = CGRect(origin: .zero, size: imagen.size)
    return imagen.cgImage(forProposedRect: &rect, context: nil, hints: nil)
}

var salida = ""
for i in 0..<min(documento.pageCount, maxPaginas) {
    guard let pagina = documento.page(at: i) else { continue }
    var texto = (pagina.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if texto.count < MIN_TEXTO_PROPIO, let imagen = renderizar(pagina) {
        // Página escaneada: OCR; si casi no sale nada, se prueba girada (hay escaneos de lado).
        texto = reconocer(imagen)
        if texto.count < MIN_TEXTO_PROPIO {
            for grados in [90, 270] {
                if let girada = rotar(imagen, grados: grados) {
                    let t = reconocer(girada)
                    if t.count > texto.count { texto = t }
                }
            }
        }
    }
    salida += "--- Página \(i + 1) ---\n\(texto)\n"
}
FileHandle.standardOutput.write(salida.data(using: .utf8)!)
