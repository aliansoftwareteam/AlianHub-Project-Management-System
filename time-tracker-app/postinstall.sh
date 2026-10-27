#!/bin/bash
if command -v xdg-mime >/dev/null 2>&1; then
  xdg-mime default alianhub-tracker.desktop x-scheme-handler/alianhub-tracker
fi
