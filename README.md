# AntiDante

Стриминг аудио по сети через GStreamer с минимальной задержкой. Захватывает звук приложений Windows (WASAPI2 loopback) и отправляет по multicast UDP.

## Требования

- **Windows 10/11** (x64)
- **Node.js** 18+
- **GStreamer** (MSVC 64-bit) — runtime + development

## Установка GStreamer

1. Скачайте **оба** пакета (runtime и development) с [gstreamer.freedesktop.org/download](https://gstreamer.freedesktop.org/download/)
2. При установке выберите **Complete** (полная установка)
3. Добавьте `C:\gstreamer\1.0\msvc_x86_64\bin` в системную переменную `PATH`
4. Перезагрузите систему

## Установка проекта

```bash
cd antiDante
npm install
```

## Запуск

Двойной клик по `start.bat` или из терминала:

```bash
npm start
```

## Автозагрузка Windows

**Добавить в автозагрузку:**

```
autostart.bat
```

Двойной клик — создаёт ярлык в папке `shell:startup`, приложение будет запускаться свёрнутым при входе в систему.

**Удалить из автозагрузки:**

```
autostart.bat remove
```

## Настройка потоков

Каждое аудиоустройство отображается карточкой в интерфейсе. Раскройте карточку для настройки:

| Параметр | Описание | По умолчанию |
|---|---|---|
| **Multicast IP** | Адрес `239.0.7.x` (последний октет 1–254) | `239.0.7.1` |
| **Порт** | UDP-порт (1024–65535) | `7777` |
| **Bind адрес** | Сетевой интерфейс для отправки | Все (`0.0.0.0`) |
| **Автозапуск** | Запускать поток при старте приложения | Выкл |

Изменённые параметры подсвечиваются жёлтым. Кнопка «Сохранить» активируется только при наличии изменений. Если поток был запущен — он автоматически перезапустится после сохранения.

## Приём потока

На принимающей машине (Linux / Windows / macOS) с установленным GStreamer:

```bash
gst-launch-1.0 udpsrc address=239.0.7.1 port=7777 auto-multicast=true ! "application/x-rtp,media=audio,clock-rate=48000,encoding-name=L16,channels=2" ! rtpL16depay ! audioconvert ! autoaudiosink
```

## Структура проекта

```
antiDante/
├── main.js          # Electron main process — GStreamer, IPC, конфиг
├── preload.js       # Context bridge для renderer
├── renderer.js      # UI-логика
├── index.html       # Разметка
├── style.css        # Стили
├── start.bat        # Запуск приложения
├── autostart.bat    # Добавить/удалить из автозагрузки
└── package.json
```

## Лицензия

ISC
