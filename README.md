# misskey-anonymous-bot


Explanation of the hash an end of message

```
Anonymous unless origin claim MAC

k = personal key
t = text
o = one time pad
H = hash function

Signature: (o, H(H(o|k)|t))
Claim origin: provide H(o|k)

In the bot, t is sender username, and k is a private server key, i.e., I can provide verification without expose server key.
```
