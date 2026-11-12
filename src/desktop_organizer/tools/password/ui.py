from __future__ import annotations

from PySide6.QtCore import QTimer
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QFormLayout,
    QLabel,
    QLineEdit,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)

from desktop_organizer.app.base import ToolPage
from desktop_organizer.app.widgets import button, muted, row, status
from desktop_organizer.core.i18n import t
from desktop_organizer.tools.password.logic import (
    PasswordOptions,
    generate_passphrase,
    generate_password,
    passphrase_entropy_bits,
    password_entropy_bits,
    strength_level,
)

CLIPBOARD_CLEAR_SECONDS = 30


class PasswordPage(ToolPage):
    def build(self, layout: QVBoxLayout) -> None:
        layout.addWidget(muted(t("password.intro")))
        self._mode = QCheckBox(t("password.passphrase_mode"))
        self._mode.toggled.connect(self._mode_changed)
        layout.addWidget(self._mode)

        self._form_widget = QWidget()
        form = QFormLayout(self._form_widget)
        self._length = QSpinBox()
        self._length.setRange(4, 128)
        self._length.setValue(20)
        self._lower = QCheckBox(t("password.lower"))
        self._upper = QCheckBox(t("password.upper"))
        self._digits = QCheckBox(t("password.digits"))
        self._symbols = QCheckBox(t("password.symbols"))
        self._ambiguous = QCheckBox(t("password.exclude_ambiguous"))
        for box in (self._lower, self._upper, self._digits):
            box.setChecked(True)
        self._symbols.setChecked(True)
        form.addRow(t("password.length"), self._length)
        form.addRow("", self._lower)
        form.addRow("", self._upper)
        form.addRow("", self._digits)
        form.addRow("", self._symbols)
        form.addRow("", self._ambiguous)
        layout.addWidget(self._form_widget)

        self._words = QSpinBox()
        self._words.setRange(3, 20)
        self._words.setValue(6)
        self._separator = QLineEdit("-")
        self._separator.setMaxLength(3)
        self._capitalize = QCheckBox(t("password.capitalize"))
        self._pass_widget = QWidget()
        pform = QFormLayout(self._pass_widget)
        pform.addRow(t("password.words"), self._words)
        pform.addRow(t("password.separator"), self._separator)
        pform.addRow("", self._capitalize)
        self._pass_widget.setVisible(False)
        layout.addWidget(self._pass_widget)

        self._output = QLineEdit()
        self._output.setReadOnly(True)
        self._output.setMinimumHeight(32)
        layout.addWidget(self._output)
        self._strength = status("")
        layout.addWidget(self._strength)

        generate = button("password.generate", primary=True, parent=self)
        copy = button("password.copy", parent=self)
        generate.clicked.connect(self._generate)
        copy.clicked.connect(self._copy)
        layout.addLayout(row(generate, copy, stretch_last=True))
        layout.addWidget(muted(t("password.clipboard_note", seconds=CLIPBOARD_CLEAR_SECONDS)))
        layout.addStretch(1)

        self._clear_timer = QTimer(self)
        self._clear_timer.setSingleShot(True)
        self._clear_timer.timeout.connect(self._clear_clipboard)
        self._copied_text = ""
        self._generate()

    def _mode_changed(self, passphrase: bool) -> None:
        self._form_widget.setVisible(not passphrase)
        self._pass_widget.setVisible(passphrase)
        self._generate()

    def _options(self) -> PasswordOptions:
        return PasswordOptions(
            length=self._length.value(),
            lower=self._lower.isChecked(),
            upper=self._upper.isChecked(),
            digits=self._digits.isChecked(),
            symbols=self._symbols.isChecked(),
            exclude_ambiguous=self._ambiguous.isChecked(),
        )

    def _generate(self) -> None:
        try:
            if self._mode.isChecked():
                value = generate_passphrase(
                    self._words.value(), self._separator.text() or "-", self._capitalize.isChecked()
                )
                bits = passphrase_entropy_bits(self._words.value())
            else:
                options = self._options()
                value = generate_password(options)
                bits = password_entropy_bits(options)
        except ValueError as exc:
            self._output.clear()
            self._strength.setText(str(exc))
            self._strength.setProperty("role", "status-error")
            self._restyle(self._strength)
            return
        self._output.setText(value)
        level = strength_level(bits)
        kind = {"weak": "error", "fair": "warn", "good": "muted", "strong": "ok"}[level]
        self._strength.setProperty("role", "muted" if kind == "muted" else f"status-{kind}")
        self._restyle(self._strength)
        self._strength.setText(t("password.strength", level=t(f"password.level.{level}"), bits=f"{bits:.0f}"))

    @staticmethod
    def _restyle(widget: QLabel) -> None:
        widget.style().unpolish(widget)
        widget.style().polish(widget)

    def _copy(self) -> None:
        text = self._output.text()
        if not text:
            return
        clipboard = QApplication.clipboard()
        clipboard.setText(text)
        self._copied_text = text
        self._clear_timer.start(CLIPBOARD_CLEAR_SECONDS * 1000)
        self._strength.setText(t("password.copied", seconds=CLIPBOARD_CLEAR_SECONDS))

    def _clear_clipboard(self) -> None:
        clipboard = QApplication.clipboard()
        if clipboard.text() == self._copied_text:
            clipboard.clear()
        self._copied_text = ""

    def shutdown(self) -> None:
        self._clear_timer.stop()
        self._clear_clipboard()
        super().shutdown()
