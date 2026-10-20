#!/bin/sh
echo CONF
grep -iE 'tcp|localsocket|foreground' /etc/clamav/clamd.conf 2>/dev/null || echo 'no-clamd.conf'
echo LISTEN4
wc -l /proc/net/tcp 2>/dev/null
echo LISTEN6
wc -l /proc/net/tcp6 2>/dev/null
echo PS
ps
echo PING4
printf 'PING\n' | nc 127.0.0.1 3310 || echo ping4-fail
echo PING6
printf 'PING\n' | nc ::1 3310 || echo ping6-fail
