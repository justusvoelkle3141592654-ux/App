from __future__ import annotations

import psutil
from PySide6.QtCore import QTimer
from PySide6.QtWidgets import QFormLayout, QLabel, QProgressBar, QVBoxLayout, QWidget

from desktop_organizer.app.base import ToolPage
from desktop_organizer.app.widgets import muted
from desktop_organizer.core.i18n import t
from desktop_organizer.tools.file_sizes.logic import human_size

REFRESH_MS = 1000


def battery_text() -> str:
    battery = psutil.sensors_battery()
    if battery is None:
        return t("system.no_battery")
    state = t("system.charging") if battery.power_plugged else t("system.on_battery")
    return f"{battery.percent:.0f} % ({state})"


def disk_lines() -> list[tuple[str, float, str]]:
    """Mount point, used percent and text for every fixed drive we can read."""
    lines: list[tuple[str, float, str]] = []
    for part in psutil.disk_partitions(all=False):
        if "cdrom" in part.opts.lower() or part.fstype == "":
            continue
        try:
            usage = psutil.disk_usage(part.mountpoint)
        except OSError:
            continue
        text = f"{human_size(usage.free)} {t('system.free_of')} {human_size(usage.total)}"
        lines.append((part.mountpoint, usage.percent, text))
    return lines


class SystemMonitorPage(ToolPage):
    def build(self, layout: QVBoxLayout) -> None:
        layout.addWidget(muted(t("system.intro")))
        psutil.cpu_percent(interval=None)  # first call primes the counter
        form = QFormLayout()
        self._cpu = QProgressBar()
        self._cpu.setRange(0, 100)
        self._mem = QProgressBar()
        self._mem.setRange(0, 100)
        self._mem_text = QLabel("")
        self._battery = QLabel("")
        form.addRow(t("system.cpu"), self._cpu)
        form.addRow(t("system.memory"), self._mem)
        form.addRow("", self._mem_text)
        form.addRow(t("system.battery"), self._battery)
        layout.addLayout(form)

        self._disks_host = QWidget()
        self._disks_layout = QFormLayout(self._disks_host)
        self._disk_bars: dict[str, QProgressBar] = {}
        layout.addWidget(QLabel(t("system.disks")))
        layout.addWidget(self._disks_host)
        layout.addStretch(1)

        self._timer = QTimer(self)
        self._timer.timeout.connect(self._refresh)
        self._timer.start(REFRESH_MS)
        self._refresh(initial=True)

    def _refresh(self, initial: bool = False) -> None:
        self._cpu.setValue(int(round(psutil.cpu_percent(interval=None))))
        memory = psutil.virtual_memory()
        self._mem.setValue(int(round(memory.percent)))
        self._mem_text.setText(f"{human_size(memory.used)} {t('system.used_of')} {human_size(memory.total)}")
        self._battery.setText(battery_text())
        if initial or self._disk_bars.keys() != {mp for mp, _, _ in disk_lines()}:
            self._rebuild_disks()
        for mount, percent, text in disk_lines():
            bar = self._disk_bars.get(mount)
            if bar is not None:
                bar.setValue(int(round(percent)))
                bar.setFormat(f"{text}")

    def _rebuild_disks(self) -> None:
        while self._disks_layout.rowCount():
            self._disks_layout.removeRow(0)
        self._disk_bars.clear()
        for mount, _percent, _text in disk_lines():
            bar = QProgressBar()
            bar.setRange(0, 100)
            bar.setFormat("%p%")
            self._disk_bars[mount] = bar
            self._disks_layout.addRow(mount, bar)

    def shutdown(self) -> None:
        self._timer.stop()
        super().shutdown()
