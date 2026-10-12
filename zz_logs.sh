#!/bin/bash
journalctl -u resultapp-provision --since '5 min ago' --no-pager \
  | grep -E 'admin\.py|NameError|UnboundLocal|profile update failed|Error' \
  | tail -20